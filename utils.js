import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { LOGICAL_DAY_OFFSET } from './constants.js';

export function getSettings(extension) {
  let GioSSS = Gio.SettingsSchemaSource;
  let schemaSource = GioSSS.new_from_directory(
    extension.dir.get_child("schemas").get_path(),
    GioSSS.get_default(),
    false
  );

  let schemaObj = schemaSource.lookup('org.gnome.shell.extensions.pomer', true);
  if (!schemaObj) {
    throw new Error('Schema org.gnome.shell.extensions.pomer could not be found');
  }
  return new Gio.Settings({ settings_schema: schemaObj });
}

export function getLogicalDate() {
  return GLib.DateTime.new_now_local().add_hours(-LOGICAL_DAY_OFFSET);
}

export function formatTime(seconds) {
  let mins = Math.floor(seconds / 60);
  let secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function playSound(extensionPath) {
  const soundFile = extensionPath + '/assets/audio/ring.mp3';

  try {
    if (Gio.File.new_for_path(soundFile).query_exists(null)) {

      const command = `gst-play-1.0 --no-interactive '${soundFile}'`;

      // Alternatively, if you want to stick to paplay but safeguard it:
      // const command = `paplay '${soundFile}'`;

      GLib.spawn_command_line_async(command);
    } else {
      Main.notify('Pomodoro Timer', 'Sound file not found.');
    }
  } catch (e) {
    log(`Pomodoro Timer: Failed to play sound. ${e}`);
  }
}
