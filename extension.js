import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { PomodoroTimer } from './pomodoroTimer.js';
import { getSettings } from './utils.js';

export default class PomodoroExtension extends Extension {
  enable() {
    this._settings = getSettings(this);
    this._indicator = new PomodoroTimer(this, this._settings);
    Main.panel.addToStatusArea('pomodoro-timer', this._indicator);
  }

  disable() {
    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }
    this._settings = null;
  }
}
