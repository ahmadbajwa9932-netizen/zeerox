const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const SCRIPT_DIR = __dirname;
const MYSQL_PATH = 'C:\\xampp\\mysql\\bin\\mysqldump.exe';
const RCLONE_PATH = path.join(SCRIPT_DIR, 'tools', 'rclone.exe');
const BACKUP_DIR = path.join(process.env.APPDATA, 'ZeeroX', 'backups');
const LOG_FILE = path.join(process.env.APPDATA, 'ZeeroX', 'backup.log');

// Reads backend/.env directly — no npm package needed for the bundled node.exe to work
function loadEnv(envPath) {
  const env = {};
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) env[match[1]] = (match[2] || '').replace(/^["']|["']$/g, '');
    });
  }
  return env;
}

const backendEnv = loadEnv(path.join(SCRIPT_DIR, 'backend', '.env'));
const DB_NAME = backendEnv.DB_NAME || 'pos-system1';
const DB_USER = backendEnv.DB_USER || 'root';
const DB_PASS = backendEnv.DB_PASS || '';

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  console.log(line.trim());
  try { fs.appendFileSync(LOG_FILE, line); } catch (err) {}
}

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

function execHidden(command, callback) {
  exec(command, { windowsHide: true }, callback);
}

function createBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(BACKUP_DIR, `backup_${timestamp}.sql`);
  const dumpCmd = `"${MYSQL_PATH}" -u ${DB_USER} ${DB_PASS ? `-p${DB_PASS}` : ''} ${DB_NAME} --ignore-table=${DB_NAME}.licenses > "${backupFile}"`;

  log('🔄 Creating database backup...');
  execHidden(dumpCmd, (error) => {
    if (error) {
      log(`❌ Backup failed: ${error.message}`);
      showNotification('Backup Failed', 'Database backup could not be created');
      return;
    }
    log(`✅ Backup created: ${backupFile}`);
    uploadToGoogleDrive(backupFile);
  });
}

function uploadToGoogleDrive(backupFile) {
  const remotePath = 'ZeeroX_Backups';
  const uploadCmd = `"${RCLONE_PATH}" copy "${backupFile}" "gdrive:${remotePath}" --progress`;

  log('☁️ Uploading to Google Drive...');
  execHidden(uploadCmd, (error, stdout, stderr) => {
    if (error) {
      log(`❌ Upload failed: ${error.message}`);
      log(`stderr: ${stderr}`);
      showNotification('Upload Failed', 'Could not upload to Google Drive');
      return;
    }
    log('✅ Upload complete');
    cleanOldBackups(remotePath);
    try {
      fs.unlinkSync(backupFile);
      log(`🗑️ Local backup deleted: ${backupFile}`);
    } catch (err) {
      log(`⚠️ Could not delete local backup: ${err.message}`);
    }
    showNotification('Backup Successful', 'Database backed up to Google Drive');
  });
}

function cleanOldBackups(remotePath) {
  const listCmd = `"${RCLONE_PATH}" lsjson "gdrive:${remotePath}"`;
  log('🧹 Cleaning old backups...');
  execHidden(listCmd, (error, stdout) => {
    if (error) {
      log(`⚠️ Could not list remote files: ${error.message}`);
      return;
    }
    try {
      const files = JSON.parse(stdout)
        .filter(f => f.Name.endsWith('.sql'))
        .map(f => ({ name: f.Name, time: new Date(f.ModTime) }))
        .sort((a, b) => b.time - a.time);

      log(`Found ${files.length} backup(s) on Google Drive`);
      if (files.length > 2) {
        files.slice(2).forEach(file => {
          const deleteCmd = `"${RCLONE_PATH}" deletefile "gdrive:${remotePath}/${file.name}"`;
          execHidden(deleteCmd, (err) => {
            if (err) log(`⚠️ Failed to delete ${file.name}: ${err.message}`);
            else log(`🗑️ Deleted old backup: ${file.name}`);
          });
        });
      }
    } catch (parseErr) {
      log(`⚠️ Could not parse file list: ${parseErr.message}`);
    }
  });
}

function showNotification(title, body) {
  log(`📢 Notification: ${title} - ${body}`);
  const notifyCmd = `powershell -Command "& {Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $notify = New-Object System.Windows.Forms.NotifyIcon; $notify.Icon = [System.Drawing.SystemIcons]::Information; $notify.Visible = $true; $notify.ShowBalloonTip(5000, '${title}', '${body}', [System.Windows.Forms.ToolTipIcon]::Info)}"`;
  execHidden(notifyCmd, (err) => { if (err) log(`⚠️ Notification failed: ${err.message}`); });
}

log('='.repeat(50));
log('🚀 ZeeroX Backup Started');
log('='.repeat(50));
createBackup();