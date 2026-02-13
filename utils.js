import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { LOGICAL_DAY_OFFSET } from './constants.js';


export function getSettings(extension) {
  let schemaId = 'org.gnome.shell.extensions.pomer';
  let schemaSource = Gio.SettingsSchemaSource.new_from_directory(
    extension.dir.get_child("schemas").get_path(),
    Gio.SettingsSchemaSource.get_default(),
    false
  );

  let schemaObj = schemaSource.lookup(schemaId, true);
  if (!schemaObj) {
    throw new Error(`Schema ${schemaId} could not be found`);
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
  const soundFile = Gio.File.new_for_path(extensionPath + '/assets/audio/ring.ogg');

  if (!soundFile.query_exists(null)) {
    Main.notify('Pomodoro Timer', 'Sound file not found.');
    return;
  }

  try {
    const player = global.display.get_sound_player();
    player.play_from_file(soundFile, 'Pomodoro Timer', null);
  } catch (e) {
    console.error(`Pomodoro Timer: Failed to play sound. ${e}`);
  }
}
