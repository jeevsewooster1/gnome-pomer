import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gst from 'gi://Gst';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { LOGICAL_DAY_OFFSET } from './constants.js';

try {
  if (!Gst.is_initialized()) {
    Gst.init(null);
  }
} catch (e) {
  try {
    Gst.init([]);
  } catch (err) {
    log(`Pomodoro Timer: Gst init warning: ${err.message}`);
  }
}

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
  const soundFile = extensionPath + '/assets/audio/ring.ogg';
  const file = Gio.File.new_for_path(soundFile);

  if (!file.query_exists(null)) {
    // Main.notify('Pomodoro Timer', 'Sound file not found.');
    return;
  }

  try {
    let player = Gst.ElementFactory.make("playbin", "player");

    if (!player) {

      const command = `gst-play-1.0 --no-interactive '${soundFile}'`;
      GLib.spawn_command_line_async(command);
      return;
    }

    player.set_property("uri", file.get_uri());
    player.set_state(Gst.State.PLAYING);

    let bus = player.get_bus();
    bus.add_signal_watch();

    const signalId = bus.connect("message", (bus, message) => {
      if (message.type === Gst.MessageType.EOS || message.type === Gst.MessageType.ERROR) {
        player.set_state(Gst.State.NULL);
        bus.remove_signal_watch();
        bus.disconnect(signalId);
      }
    });

  } catch (e) {
    log(`Pomodoro Timer: Failed to play sound. ${e}`);
  }
}
