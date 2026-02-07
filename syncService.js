import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

export class SyncService {
  constructor(extensionPath) {
    this._extensionPath = extensionPath;
    this._config = this._loadConfig();
    this._session = new Soup.Session();
  }

  _loadConfig() {
    const configFile = Gio.File.new_for_path(this._extensionPath + '/.env');
    const config = { SYNC_URL: '', SYNC_TOKEN: '' };

    try {
      const [success, contents] = configFile.load_contents(null);
      if (success) {
        const decoder = new TextDecoder('utf-8');
        const text = decoder.decode(contents);
        text.split('\n').forEach(line => {
          const [key, value] = line.split('=');
          if (key && value) {
            config[key.trim()] = value.trim();
          }
        });
      }
    } catch (e) {
      console.error('Failed to load .env file:', e);
    }
    return config;
  }

  async sync(localData) {
    if (!this._config.SYNC_URL || !this._config.SYNC_TOKEN) {
      throw new Error('Missing SYNC_URL or SYNC_TOKEN in .env');
    }

    const payload = {
      updatedAt: localDataPayload.updatedAt || Date.now(),
      payload: localDataPayload
    };
    const message = Soup.Message.new('POST', this._config.SYNC_URL);

    message.request_headers.append('Authorization', `Bearer ${this._config.SYNC_TOKEN}`);
    message.request_headers.append('Content-Type', 'application/json');

    const encoder = new TextEncoder();
    message.set_request_body_from_bytes(
      'application/json',
      new GLib.Bytes(encoder.encode(JSON.stringify(payload)))
    );

    return new Promise((resolve, reject) => {
      this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
        try {
          const bytes = session.send_and_read_finish(result);
          const decoder = new TextDecoder('utf-8');
          const responseText = decoder.decode(bytes.get_data());

          if (message.status_code !== 200) {
            reject(new Error(`Server Error: ${message.status_code}`));
            return;
          }

          const response = JSON.parse(responseText);
          resolve(response);
        } catch (e) {
          reject(e);
        }
      });
    });
  }
}
