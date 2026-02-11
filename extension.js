import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import { PomodoroTimer } from './pomodoroTimer.js';
import { getSettings } from './utils.js';

export default class PomodoroExtension extends Extension {
  enable() {
    console.log('POMER: Enabling extension...');
    this._settings = this.getSettings();

    if (Main.panel.statusArea[this.uuid]) {
      console.warn(`POMER: Removing zombie indicator for ${this.uuid}`);
      Main.panel.statusArea[this.uuid].destroy();
    }

    this._timer = new PomodoroTimer(this, this._settings);
    Main.panel.addToStatusArea(this.uuid, this._timer);

    const action = Main.wm.addKeybinding(
      'toggle-timer',
      this._settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.ALL,
      () => {
        console.log('POMER: Shortcut <Alt>P pressed!');
        if (this._timer) this._timer.toggleTimer();
      }
    );
  }

  disable() {
    Main.wm.removeKeybinding('toggle-timer');

    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }
    this._settings = null;
  }
}
