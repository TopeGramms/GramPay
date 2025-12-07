import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class NetworkDiagnostics {
    /**
     * Check if WhatsApp servers are reachable
     */
    static async checkWhatsAppConnectivity() {
        try {
            const endpoints = [
                'https://web.whatsapp.com',
                'https://v.whatsapp.net/v2',
            ];

            const results = await Promise.allSettled(
                endpoints.map(url =>
                    axios.get(url, { timeout: 5000, validateStatus: () => true })
                )
            );

            const reachable = results.some(r => r.status === 'fulfilled');

            return {
                reachable,
                details: results.map((r, i) => ({
                    endpoint: endpoints[i],
                    status: r.status === 'fulfilled' ? 'reachable' : 'unreachable',
                    error: r.status === 'rejected' ? r.reason.message : null
                }))
            };
        } catch (error) {
            return {
                reachable: false,
                error: error.message
            };
        }
    }

    /**
     * Detect network type (WiFi, Mobile Data, VPN, etc.)
     */
    static async detectNetworkType() {
        try {
            // Check if using VPN by looking at DNS or routing
            const { stdout: routeInfo } = await execAsync('route print').catch(() => ({ stdout: '' }));
            const hasVPN = routeInfo.toLowerCase().includes('vpn') ||
                routeInfo.toLowerCase().includes('tunnel');

            // Check public IP to detect proxy/VPN
            let publicIP = null;
            let isMobile = false;

            try {
                const ipResponse = await axios.get('https://api.ipify.org?format=json', { timeout: 3000 });
                publicIP = ipResponse.data.ip;

                // Check if IP is from mobile carrier (basic heuristic)
                const ipInfo = await axios.get(`https://ipapi.co/${publicIP}/json/`, { timeout: 3000 });
                isMobile = ipInfo.data.org?.toLowerCase().includes('mobile') ||
                    ipInfo.data.org?.toLowerCase().includes('cellular');
            } catch (e) {
                // Ignore IP detection errors
            }

            return {
                hasVPN,
                isMobile,
                publicIP,
                recommendation: this.getNetworkRecommendation(hasVPN, isMobile)
            };
        } catch (error) {
            return {
                hasVPN: false,
                isMobile: false,
                error: error.message,
                recommendation: 'Unable to detect network type'
            };
        }
    }

    /**
     * Get network-based recommendation
     */
    static getNetworkRecommendation(hasVPN, isMobile) {
        if (hasVPN) {
            return '⚠️ VPN detected. Try disabling VPN during pairing, or use pairing code method.';
        }
        if (isMobile) {
            return '📱 Mobile network detected. This usually works well for WhatsApp pairing.';
        }
        return '💡 WiFi detected. If QR fails, try mobile hotspot or pairing code method.';
    }

    /**
     * Recommend best pairing method based on network conditions
     */
    static async recommendPairingMethod() {
        try {
            const connectivity = await this.checkWhatsAppConnectivity();
            const network = await this.detectNetworkType();

            if (!connectivity.reachable) {
                return {
                    method: 'none',
                    reason: '❌ WhatsApp servers unreachable. Check your internet connection.',
                    canProceed: false
                };
            }

            if (network.hasVPN) {
                return {
                    method: 'pairing-code',
                    reason: '🔐 VPN detected. Pairing code method is more reliable with VPN.',
                    canProceed: true
                };
            }

            if (network.isMobile) {
                return {
                    method: 'qr-code',
                    reason: '📱 Mobile network is ideal for QR code pairing.',
                    canProceed: true
                };
            }

            return {
                method: 'qr-code',
                reason: '✅ Network conditions are good. QR code should work.',
                fallback: 'If QR fails, try pairing code method.',
                canProceed: true
            };
        } catch (error) {
            return {
                method: 'qr-code',
                reason: 'Unable to analyze network. Try QR code first.',
                fallback: 'If issues occur, use pairing code method.',
                canProceed: true
            };
        }
    }

    /**
     * Test WebSocket connection capability
     */
    static async testWebSocketConnection() {
        try {
            // Test if WebSocket connections are allowed
            const wsTest = await axios.get('https://web.whatsapp.com', {
                timeout: 5000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            return {
                capable: wsTest.status === 200,
                status: wsTest.status
            };
        } catch (error) {
            return {
                capable: false,
                error: error.message,
                recommendation: 'WebSocket may be blocked. Try pairing code method or different network.'
            };
        }
    }

    /**
     * Run comprehensive diagnostics
     */
    static async runDiagnostics() {
        console.log('\n🔍 Running network diagnostics...\n');

        const connectivity = await this.checkWhatsAppConnectivity();
        const network = await this.detectNetworkType();
        const websocket = await this.testWebSocketConnection();
        const recommendation = await this.recommendPairingMethod();

        const report = {
            timestamp: new Date().toISOString(),
            connectivity,
            network,
            websocket,
            recommendation
        };

        // Print summary
        console.log('📊 Diagnostic Report:');
        console.log('━'.repeat(60));
        console.log(`WhatsApp Reachable: ${connectivity.reachable ? '✅ Yes' : '❌ No'}`);
        console.log(`Network Type: ${network.isMobile ? '📱 Mobile' : '💻 WiFi/Wired'}`);
        console.log(`VPN Detected: ${network.hasVPN ? '⚠️ Yes' : '✅ No'}`);
        console.log(`WebSocket Capable: ${websocket.capable ? '✅ Yes' : '❌ No'}`);
        console.log('━'.repeat(60));
        console.log(`\n💡 Recommendation: ${recommendation.reason}`);
        if (recommendation.fallback) {
            console.log(`   Fallback: ${recommendation.fallback}`);
        }
        console.log('');

        return report;
    }
}
