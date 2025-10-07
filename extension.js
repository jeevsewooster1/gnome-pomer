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
      this._tasks = [];
      this._activeTaskId = null;

      this._label = new St.Label({ text: this._formatTime(this._timeLeft), y_align: Clutter.ActorAlign.CENTER });
      this._icon = new St.Icon({ style_class: 'system-status-icon', icon_size: 34 });

      let box = new St.BoxLayout();
      box.add_child(this._icon);
      box.add_child(this._label);
      this.add_child(box);

      this._buildMenu();
      this._loadState();
      this._updateUI();
    }

    _loadState() {
      const tasksJson = this._settings.get_strv('tasks');
      this._tasks = tasksJson.map(json => {
        try { return JSON.parse(json); } catch (e) { return null; }
      }).filter(task => task !== null);

      const todayStr = GLib.DateTime.new_now_local().format('%Y-%m-%d');
      const lastDate = this._settings.get_string('last-cycle-date');

      if (todayStr === lastDate) {
        this._cyclesToday = this._settings.get_int('cycles-today');
      } else {
        this._cyclesToday = 0;
        this._tasks.forEach(task => task.completed = 0);
      }

      this._activeTaskId = this._settings.get_string('active-task-id');
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
      this._settings.set_string('last-cycle-date', GLib.DateTime.new_now_local().format('%Y-%m-%d'));
      const tasksJson = this._tasks.map(task => JSON.stringify(task));
      this._settings.set_strv('tasks', tasksJson);
      this._settings.set_string('active-task-id', this._activeTaskId || '');
    }

    _buildMenu() {
      this.menu.removeAll();

      this._progressMenuItem = new PopupMenu.PopupMenuItem('');
      this._progressMenuItem.sensitive = false;
      this.menu.addMenuItem(this._progressMenuItem);

      this._taskProgressMenuItem = new PopupMenu.PopupMenuItem('');
      this._taskProgressMenuItem.sensitive = false;
      this.menu.addMenuItem(this._taskProgressMenuItem);

      // REWORKED: This section now holds the dynamic list of tasks.
      this._taskSection = new PopupMenu.PopupMenuSection();
      this.menu.addMenuItem(this._taskSection);

      // Section for adding a new task
      let addTaskSeparator = new PopupMenu.PopupSeparatorMenuItem("ADD NEW TASK");
      this.menu.addMenuItem(addTaskSeparator);
      let addTaskItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
      let taskBox = new St.BoxLayout({ vertical: false, style: 'spacing: 6px;' });
      addTaskItem.add_child(taskBox);

      this._taskNameEntry = new St.Entry({ hint_text: 'Task Name', can_focus: true, x_expand: true });
      taskBox.add_child(this._taskNameEntry);

      this._taskIntervalsEntry = new St.Entry({ hint_text: '#', can_focus: true, style: 'width: 50px;' });
      this._taskIntervalsEntry.get_clutter_text().connect('text-changed', () => {
        let text = this._taskIntervalsEntry.get_text();
        this._taskIntervalsEntry.set_text(text.replace(/[^0-9]/g, ''));
      });
      taskBox.add_child(this._taskIntervalsEntry);

      let addTaskButton = new St.Button({ label: 'Add', style_class: 'button', can_focus: true });
      addTaskButton.connect('clicked', () => this._addTask());
      taskBox.add_child(addTaskButton);
      this.menu.addMenuItem(addTaskItem);

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      this._startPauseItem = new PopupMenu.PopupMenuItem('Start');
      this._startPauseItem.connect('activate', () => this._toggleTimer());
      this.menu.addMenuItem(this._startPauseItem);

      let resetItem = new PopupMenu.PopupMenuItem('Reset');
      resetItem.connect('activate', () => this._reset());
      this.menu.addMenuItem(resetItem);
    }

    // REWORKED: Complete overhaul of the task menu for better UX.
    _rebuildTaskMenu() {
      this._taskSection.removeAll();

      // Add the "None" option first
      let noneItem = new PopupMenu.PopupMenuItem('No Active Task');
      if (!this._activeTaskId) {
        noneItem.setOrnament(PopupMenu.Ornament.DOT);
      }
      noneItem.connect('activate', () => this._setActiveTask(null));
      this._taskSection.addMenuItem(noneItem);

      this._taskSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      // Add each user-created task
      this._tasks.forEach(task => {
        // Use a BaseMenuItem to hold a box layout for more control
        let taskItem = new PopupMenu.PopupBaseMenuItem();
        let itemBox = new St.BoxLayout({ vertical: false, x_expand: true, style: 'spacing: 10px;' });
        taskItem.add_child(itemBox);

        // The main label for the task, expands to fill space
        let label = new St.Label({ text: `${task.name} (${task.completed}/${task.target})`, x_expand: true });
        itemBox.add_child(label);

        // Delete button
        let deleteButton = new St.Button({
          style_class: 'button icon-button',
          child: new St.Icon({ icon_name: 'edit-delete-symbolic', style_class: 'popup-menu-icon' })
        });
        deleteButton.connect('clicked', () => this._deleteTask(task.id));
        itemBox.add_child(deleteButton);

        // Clicking anywhere on the item (except the button) sets it active
        taskItem.connect('activate', () => this._setActiveTask(task.id));

        // Set the "radio" dot if it's the active task
        if (task.id === this._activeTaskId) {
          taskItem.setOrnament(PopupMenu.Ornament.DOT);
        }

        this._taskSection.addMenuItem(taskItem);
      });
    }

    _addTask() {
      const name = this._taskNameEntry.get_text().trim();
      const target = parseInt(this._taskIntervalsEntry.get_text(), 10);

      if (name && !isNaN(target) && target > 0) {
        const newTask = {
          id: GLib.uuid_string_random(),
          name, target, completed: 0,
        };
        this._tasks.push(newTask);
        this._taskNameEntry.set_text('');
        this._taskIntervalsEntry.set_text('');

        // ENHANCEMENT: Automatically set the new task as active
        this._setActiveTask(newTask.id);
      } else {
        Main.notify('Pomodoro Timer', 'Please provide a valid name and positive number.');
      }
    }

    _setActiveTask(taskId) {
      this._activeTaskId = taskId;
      this._updateUI();
      this._saveState();
    }

    _deleteTask(taskId) {
      this._tasks = this._tasks.filter(t => t.id !== taskId);
      if (this._activeTaskId === taskId) {
        this._activeTaskId = null;
      }
      this._updateUI();
      this._saveState();
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
          this._tasks.forEach(task => task.completed = 0);
        } else {
          this._cyclesToday++;
        }

        if (this._activeTaskId) {
          const activeTask = this._tasks.find(t => t.id === this._activeTaskId);
          if (activeTask) { activeTask.completed++; }
        }

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

    _updateUI() {
      this._label.set_text(this._formatTime(this._timeLeft));
      const progressText = `Until Long Break: ${this._workCycleCount}/${CYCLES_BEFORE_LONG_BREAK} | Today: ${this._cyclesToday}`;
      this._progressMenuItem.label.set_text(progressText);

      let activeTask = this._activeTaskId ? this._tasks.find(t => t.id === this._activeTaskId) : null;

      if (activeTask) {
        this._taskProgressMenuItem.label.set_text(`Active: ${activeTask.name} (${activeTask.completed}/${activeTask.target})`);
        this._taskProgressMenuItem.show();
      } else {
        this._taskProgressMenuItem.hide();
      }

      const iconName = (this._sessionType === Session.WORK) ? 'work.png' : 'rest.png';
      const iconPath = this._extension.path + `/assets/img/${iconName}`;
      try {
        this._icon.gicon = new Gio.FileIcon({ file: Gio.File.new_for_path(iconPath) });
      } catch (e) { this._icon.icon_name = 'dialog-error-symbolic'; }

      switch (this._state) {
        case State.RUNNING: this._startPauseItem.label.set_text('Pause'); break;
        case State.PAUSED: this._startPauseItem.label.set_text('Resume'); break;
        case State.STOPPED: this._startPauseItem.label.set_text('Start'); break;
      }
      this._rebuildTaskMenu();
    }

    // --- Unchanged methods ---
    _toggleTimer() { if (this._state === State.RUNNING) this._pause(); else this._start() }
    _start() { if (this._timerId) GLib.source_remove(this._timerId); this._state = State.RUNNING; this._updateUI(); this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => { this._timeLeft--; this._updateUI(); this._saveState(); if (this._timeLeft <= 0) { this._sessionFinished(); return GLib.SOURCE_REMOVE } return GLib.SOURCE_CONTINUE }) }
    _pause() { if (!this._timerId) return; this._state = State.PAUSED; GLib.source_remove(this._timerId); this._timerId = null; this._updateUI() }
    _reset() { if (this._timerId) { GLib.source_remove(this._timerId); this._timerId = null } this._state = State.STOPPED; this._sessionType = Session.WORK; this._timeLeft = WORK_DURATION; this._workCycleCount = 0; this._updateUI() }
    _formatTime(seconds) { let mins = Math.floor(seconds / 60); let secs = seconds % 60; return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}` }
    destroy() { if (this._timerId) { GLib.source_remove(this._timerId); this._timerId = null } this._saveState(); super.destroy() }
    _playSound() { const soundFile = this._extension.path + '/assets/audio/ring.mp3'; try { if (Gio.File.new_for_path(soundFile).query_exists(null)) { GLib.spawn_command_line_async(`paplay ${soundFile}`) } else { Main.notify('Pomodoro Timer', 'Sound file not found.') } } catch (e) { log(`Pomodoro Timer: Failed to play sound. ${e}`) } }
  });

// --- Main Extension Class ---
export default class PomodoroExtension extends Extension {
  enable() {
    this._settings = getSettings(this);
    this._indicator = new PomodoroTimer(this, this._settings);
    Main.panel.addToStatusArea('pomodoro-timer', this._indicator);
  }
  disable() {
    if (this._indicator) { this._indicator.destroy(); this._indicator = null; }
    this._settings = null;
  }
}

