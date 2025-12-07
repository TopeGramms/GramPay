import fs from 'fs';
import path from 'path';

const AUTH_DIR = path.join(process.cwd(), 'baileys_auth_info');
const BACKUP_DIR = path.join(process.cwd(), 'baileys_auth_backup');

export class SessionManager {
  /**
   * Validate if the current session is valid
   */
  static async validateSession() {
    try {
      if (!fs.existsSync(AUTH_DIR)) {
        return { valid: false, reason: 'No session directory found' };
      }

      const credsPath = path.join(AUTH_DIR, 'creds.json');
      if (!fs.existsSync(credsPath)) {
        return { valid: false, reason: 'No credentials file found' };
      }

      const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
      
      // Check if essential fields exist
      if (!creds.me || !creds.me.id) {
        return { valid: false, reason: 'Incomplete credentials' };
      }

      return { valid: true, sessionId: creds.me.id };
    } catch (error) {
      return { valid: false, reason: error.message };
    }
  }

  /**
   * Clean/delete the current session
   */
  static async cleanSession() {
    try {
      if (fs.existsSync(AUTH_DIR)) {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        console.log('✅ Session cleaned successfully');
        return { success: true };
      }
      return { success: true, message: 'No session to clean' };
    } catch (error) {
      console.error('❌ Error cleaning session:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Backup the current session
   */
  static async backupSession() {
    try {
      if (!fs.existsSync(AUTH_DIR)) {
        return { success: false, error: 'No session to backup' };
      }

      // Create backup directory if it doesn't exist
      if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
      }

      // Copy all files from auth dir to backup dir
      const files = fs.readdirSync(AUTH_DIR);
      for (const file of files) {
        const srcPath = path.join(AUTH_DIR, file);
        const destPath = path.join(BACKUP_DIR, file);
        fs.copyFileSync(srcPath, destPath);
      }

      console.log('✅ Session backed up successfully');
      return { success: true, backupPath: BACKUP_DIR };
    } catch (error) {
      console.error('❌ Error backing up session:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Restore session from backup
   */
  static async restoreSession() {
    try {
      if (!fs.existsSync(BACKUP_DIR)) {
        return { success: false, error: 'No backup found' };
      }

      // Clean current session first
      await this.cleanSession();

      // Create auth directory
      if (!fs.existsSync(AUTH_DIR)) {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
      }

      // Copy all files from backup dir to auth dir
      const files = fs.readdirSync(BACKUP_DIR);
      for (const file of files) {
        const srcPath = path.join(BACKUP_DIR, file);
        const destPath = path.join(AUTH_DIR, file);
        fs.copyFileSync(srcPath, destPath);
      }

      console.log('✅ Session restored successfully');
      return { success: true };
    } catch (error) {
      console.error('❌ Error restoring session:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get session info
   */
  static async getSessionInfo() {
    try {
      const validation = await this.validateSession();
      
      if (!validation.valid) {
        return {
          exists: false,
          valid: false,
          reason: validation.reason
        };
      }

      const credsPath = path.join(AUTH_DIR, 'creds.json');
      const stats = fs.statSync(credsPath);
      
      return {
        exists: true,
        valid: true,
        sessionId: validation.sessionId,
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
        hasBackup: fs.existsSync(BACKUP_DIR)
      };
    } catch (error) {
      return {
        exists: false,
        valid: false,
        error: error.message
      };
    }
  }
}
