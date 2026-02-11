import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import { PomodoroTimer } from './pomodoroTimer.js';

export default class PomodoroExtension extends Extension {
  enable() {
    console.log('POMER: Enabling extension...');
    this._settings = this.getSettings();

    if (Main.panel.statusArea[this.uuid]) {
      Main.panel.statusArea[this.uuid].destroy();
    }

    this._timer = new PomodoroTimer(this, this._settings);
    Main.panel.addToStatusArea(this.uuid, this._timer);

    Main.wm.addKeybinding(
      'toggle-timer',
      this._settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.ALL,
      () => {
        if (this._timer) this._timer.toggleTimer();
      }
    );

    Main.wm.addKeybinding(
      'skip-interval',
      this._settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.ALL,
      () => {
        if (this._timer) this._timer.skipInterval();
      }
    );

    Main.wm.addKeybinding(
      'reset-timer',
      this._settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.ALL,
      () => {
        if (this._timer) this._timer.resetTimer();
      }
    );
  }

  disable() {
    Main.wm.removeKeybinding('toggle-timer');
    Main.wm.removeKeybinding('skip-interval');
    Main.wm.removeKeybinding('reset-timer');

    if (this._timer) {
      this._timer.destroy();
      this._timer = null;
    }

    this._settings = null;
  }
}
