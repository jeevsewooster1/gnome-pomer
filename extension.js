// --- ES Module Imports ---
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

// --- Constants ---
const WORK_MINUTES = 25;
const SHORT_BREAK_MINUTES = 2;
const LONG_BREAK_MINUTES = 12;
const CYCLES_BEFORE_LONG_BREAK = 3;

const WORK_DURATION = WORK_MINUTES * 60;
const SHORT_BREAK_DURATION = SHORT_BREAK_MINUTES * 60;
const LONG_BREAK_DURATION = LONG_BREAK_MINUTES * 60;

const State = {
  STOPPED: 0,
  RUNNING: 1,
  PAUSED: 2,
};

const Session = {
  WORK: 'Work',
  SHORT_BREAK: 'Short Break',
  LONG_BREAK: 'Long Break',
};

// --- Settings Loader Function ---
function getSettings(extension) {
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


// --- Main Timer Logic Class ---
const PomodoroTimer = GObject.registerClass(
  class PomodoroTimer extends PanelMenu.Button {
    constructor(extension, settings) {
      super(0.0, 'Pomodoro Timer');

      this._extension = extension;
      this._settings = settings;

      this._state = State.STOPPED;
      this._sessionType = Session.WORK;
      this._timeLeft = WORK_DURATION;
      this._timerId = null;
      this._workCycleCount = 0;
      this._cyclesToday = 0;

      this._label = new St.Label({
        text: this._formatTime(this._timeLeft),
        y_align: Clutter.ActorAlign.CENTER,
      });

      this._icon = new St.Icon({
        style_class: 'system-status-icon',
        icon_size: 34,
      });

      let box = new St.BoxLayout();
      box.add_child(this._icon);
      box.add_child(this._label);
      this.add_child(box);

      this._buildMenu();
      this._loadState();
      this._updateUI();
    }

    _loadState() {
      // --- Daily Counter Reset Logic ---
      const todayStr = GLib.DateTime.new_now_local().format('%Y-%m-%d');
      const lastDate = this._settings.get_string('last-cycle-date');

      if (todayStr === lastDate) {
        this._cyclesToday = this._settings.get_int('cycles-today');
      } else {
        this._cyclesToday = 0;
      }

      // --- Original Loading Logic ---
      const state = this._settings.get_int('timer-state');
      if (state === State.STOPPED) {
        this._reset();
        return;
      }

      this._state = state;
      this._timeLeft = this._settings.get_int('time-left');
      this._workCycleCount = this._settings.get_int('work-cycle-count');
      this._sessionType = this._settings.get_string('session-type');

      if (this._state === State.RUNNING) {
        // BUG FIX: The previous logic used monotonic time to calculate elapsed
        // time, which is not persistent across reboots and caused incorrect
        // timer values.
        //
        // By saving the state every second (see _start method), the stored
        // `_timeLeft` is always up-to-date. We now simply restart the timer
        // from the last saved value. This is imperfect as it doesn't account
        // for the time while the system was off, but it's a minimal fix
        // that prevents the timer from showing erratic values.
        this._start();
      }
    }

    _saveState() {
      this._settings.set_int('timer-state', this._state);
      this._settings.set_int('time-left', this._timeLeft);
      this._settings.set_int('work-cycle-count', this._workCycleCount);
      this._settings.set_string('session-type', this._sessionType);
      this._settings.set_int64('quit-time', GLib.get_monotonic_time());
      this._settings.set_int('cycles-today', this._cyclesToday);
    }

    _buildMenu() {
      this._progressMenuItem = new PopupMenu.PopupMenuItem('');
      this._progressMenuItem.sensitive = false;
      this.menu.addMenuItem(this._progressMenuItem);

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      this._startPauseItem = new PopupMenu.PopupMenuItem('Start');
      this._startPauseItem.connect('activate', () => this._toggleTimer());
      this.menu.addMenuItem(this._startPauseItem);

      let resetItem = new PopupMenu.PopupMenuItem('Reset');
      resetItem.connect('activate', () => this._reset());
      this.menu.addMenuItem(resetItem);
    }

    _toggleTimer() {
      if (this._state === State.RUNNING) {
        this._pause();
      } else {
        this._start();
      }
    }

    _start() {
      if (this._timerId) {
        GLib.source_remove(this._timerId);
      }

      this._state = State.RUNNING;
      this._updateUI();

      this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
        this._timeLeft--;
        this._updateUI();

        // BUG FIX: Persist the timer's state on every tick.
        // This ensures that if the system reboots without a clean shutdown,
        // the timer value is not lost, providing "proper persistency".
        this._saveState();

        if (this._timeLeft <= 0) {
          this._sessionFinished();
          return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
      });
    }

    _pause() {
      if (!this._timerId) return;
      this._state = State.PAUSED;
      GLib.source_remove(this._timerId);
      this._timerId = null;
      this._updateUI();
    }

    _reset() {
      if (this._timerId) {
        GLib.source_remove(this._timerId);
        this._timerId = null;
      }

      this._state = State.STOPPED;
      this._sessionType = Session.WORK;
      this._timeLeft = WORK_DURATION;
      this._workCycleCount = 0;
      this._updateUI();
    }

    _sessionFinished(notifyAndSound = true) {
      if (notifyAndSound) {
        Main.notify('Pomodoro Timer', `${this._sessionType} session is over!`);
        this._playSound();
      }

      if (this._sessionType === Session.WORK) {
        this._workCycleCount++;

        const todayStr = GLib.DateTime.new_now_local().format('%Y-%m-%d');
        const lastDate = this._settings.get_string('last-cycle-date');

        if (todayStr !== lastDate) {
          this._cyclesToday = 1;
        } else {
          this._cyclesToday++;
        }

        this._settings.set_int('cycles-today', this._cyclesToday);
        this._settings.set_string('last-cycle-date', todayStr);

        if (this._workCycleCount >= CYCLES_BEFORE_LONG_BREAK) {
          this._sessionType = Session.LONG_BREAK;
          this._timeLeft = LONG_BREAK_DURATION;
          this._workCycleCount = 0;
        } else {
          this._sessionType = Session.SHORT_BREAK;
          this._timeLeft = SHORT_BREAK_DURATION;
        }
      } else {
        this._sessionType = Session.WORK;
        this._timeLeft = WORK_DURATION;
      }
      this._start();
    }


    _formatTime(seconds) {
      let mins = Math.floor(seconds / 60);
      let secs = seconds % 60;
      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    _updateUI() {
      this._label.set_text(this._formatTime(this._timeLeft));

      const progressText = `Until Long Break: ${this._workCycleCount} / ${CYCLES_BEFORE_LONG_BREAK} | Today: ${this._cyclesToday}`;
      this._progressMenuItem.label.set_text(progressText);

      const iconName = (this._sessionType === Session.WORK) ? 'work.png' : 'rest.png';
      const iconPath = this._extension.path + `/assets/img/${iconName}`;
      try {
        this._icon.gicon = new Gio.FileIcon({ file: Gio.File.new_for_path(iconPath) });
      } catch (e) {
        this._icon.icon_name = 'dialog-error-symbolic';
      }

      switch (this._state) {
        case State.RUNNING: this._startPauseItem.label.set_text('Pause'); break;
        case State.PAUSED: this._startPauseItem.label.set_text('Resume'); break;
        case State.STOPPED: this._startPauseItem.label.set_text('Start'); break;
      }
    }

    destroy() {
      if (this._timerId) {
        GLib.source_remove(this._timerId);
        this._timerId = null;
      }
      this._saveState();
      super.destroy();
    }

    _playSound() {
      const soundFile = this._extension.path + '/assets/audio/ring.mp3';
      try {
        if (Gio.File.new_for_path(soundFile).query_exists(null)) {
          GLib.spawn_command_line_async(`paplay ${soundFile}`);
        } else {
          Main.notify('Pomodoro Timer', 'Sound file not found.');
        }
      } catch (e) {
        log(`Pomodoro Timer: Failed to play sound. ${e}`);
      }
    }

  });


// --- Main Extension Class ---
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
