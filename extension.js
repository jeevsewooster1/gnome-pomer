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
const LOGICAL_DAY_OFFSET = 4; // 4 AM start of day

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

// --- Settings Loader ---
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
      this._timeLeft = this._settings.get_int('work-minutes') * 60;

      this._timerId = null;
      this._workCycleCount = 0;
      this._cyclesToday = 0;
      this._tasks = [];
      this._activeTaskId = null;

      this._completionHistory = {};
      this._calendarDisplayDate = this._getLogicalDate();

      this._label = new St.Label({ text: this._formatTime(this._timeLeft), y_align: Clutter.ActorAlign.CENTER });
      this._icon = new St.Icon({ style_class: 'system-status-icon', icon_size: 34 });

      let box = new St.BoxLayout();
      box.add_child(this._icon);
      box.add_child(this._label);
      this.add_child(box);

      this._buildMenu();
      this._loadState();
      this._buildCalendarUI();
      this._updateUI();
    }

    _getLogicalDate() {
      return GLib.DateTime.new_now_local().add_hours(-LOGICAL_DAY_OFFSET);
    }

    _loadState() {
      const tasksJson = this._settings.get_strv('tasks');
      this._tasks = tasksJson.map(json => {
        try { return JSON.parse(json); } catch (e) { return null; }
      }).filter(task => task !== null);

      const todayStr = this._getLogicalDate().format('%Y-%m-%d');
      const lastDate = this._settings.get_string('last-cycle-date');

      if (todayStr !== lastDate) {
        this._cyclesToday = 0;
        this._tasks.forEach(task => task.completed = 0);
      } else {
        this._cyclesToday = this._settings.get_int('cycles-today');
      }

      this._activeTaskId = this._settings.get_string('active-task-id');
      const state = this._settings.get_int('timer-state');

      try {
        const historyJson = this._settings.get_string('completion-history');
        if (historyJson) {
          this._completionHistory = JSON.parse(historyJson);
        }
      } catch (e) {
        this._completionHistory = {};
      }

      if (state === State.STOPPED) {
        this._reset();
        return;
      }

      this._state = state;
      this._timeLeft = this._settings.get_int('time-left');
      this._workCycleCount = this._settings.get_int('work-cycle-count');
      this._sessionType = this._settings.get_string('session-type');

      if (state === State.RUNNING) {
        this._state = State.PAUSED;
      } else {
        this._state = state;
      }
    }

    _saveState() {
      this._settings.set_int('timer-state', this._state);
      this._settings.set_int('time-left', this._timeLeft);
      this._settings.set_int('work-cycle-count', this._workCycleCount);
      this._settings.set_string('session-type', this._sessionType);
      this._settings.set_int64('quit-time', GLib.get_monotonic_time());
      this._settings.set_int('cycles-today', this._cyclesToday);
      this._settings.set_string('last-cycle-date', this._getLogicalDate().format('%Y-%m-%d'));

      const tasksJson = this._tasks.map(task => JSON.stringify(task));
      this._settings.set_strv('tasks', tasksJson);
      this._settings.set_string('active-task-id', this._activeTaskId || '');
      this._settings.set_string('completion-history', JSON.stringify(this._completionHistory));
    }

    _buildMenu() {
      this.menu.removeAll();

      this._progressMenuItem = new PopupMenu.PopupMenuItem('');
      this._progressMenuItem.sensitive = false;
      this.menu.addMenuItem(this._progressMenuItem);

      this._taskProgressMenuItem = new PopupMenu.PopupMenuItem('');
      this._taskProgressMenuItem.sensitive = false;
      this.menu.addMenuItem(this._taskProgressMenuItem);

      this._taskSection = new PopupMenu.PopupMenuSection();
      this.menu.addMenuItem(this._taskSection);

      // --- Add Task UI ---
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

      // --- Calendar (ALWAYS VISIBLE) ---
      let historyHeader = new PopupMenu.PopupMenuItem('History');
      historyHeader.sensitive = false;
      this.menu.addMenuItem(historyHeader);

      this._calendarContainer = new St.BoxLayout({ vertical: true, style: 'padding: 5px; spacing: 2px;' });

      let calendarMenuItem = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false
      });
      calendarMenuItem.add_child(this._calendarContainer);
      this.menu.addMenuItem(calendarMenuItem);

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      // --- Controls ---
      this._startPauseItem = new PopupMenu.PopupMenuItem('Start');
      this._startPauseItem.connect('activate', () => this._toggleTimer());
      this.menu.addMenuItem(this._startPauseItem);

      let resetItem = new PopupMenu.PopupMenuItem('Reset Timer');
      resetItem.connect('activate', () => this._reset());
      this.menu.addMenuItem(resetItem);

      let resetDailyItem = new PopupMenu.PopupMenuItem('Reset Daily Progress');
      resetDailyItem.connect('activate', () => this._resetDailyProgress());
      this.menu.addMenuItem(resetDailyItem);

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      // --- Settings Submenu ---
      let settingsSubMenu = new PopupMenu.PopupSubMenuMenuItem('Settings');
      this.menu.addMenuItem(settingsSubMenu);

      settingsSubMenu.menu.addMenuItem(this._createSettingRow('Work (min)', 'work-minutes'));
      settingsSubMenu.menu.addMenuItem(this._createSettingRow('Short Break (min)', 'short-break-minutes'));
      settingsSubMenu.menu.addMenuItem(this._createSettingRow('Long Break (min)', 'long-break-minutes'));
      settingsSubMenu.menu.addMenuItem(this._createSettingRow('Intervals per Cycle', 'cycles-before-long-break'));
    }

    _createSettingRow(labelText, settingKey) {
      let item = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
      let box = new St.BoxLayout({ x_expand: true, style: 'spacing: 10px;' });
      item.add_child(box);

      let label = new St.Label({ text: labelText, y_align: Clutter.ActorAlign.CENTER, x_expand: true });
      box.add_child(label);

      let entry = new St.Entry({
        style: 'width: 50px; text-align: right;',
        can_focus: true
      });

      entry.set_text(this._settings.get_int(settingKey).toString());

      entry.get_clutter_text().connect('text-changed', () => {
        let text = entry.get_text();
        let cleanText = text.replace(/[^0-9]/g, '');
        if (cleanText !== text) entry.set_text(cleanText);

        let val = parseInt(cleanText, 10);
        if (!isNaN(val) && val > 0) {
          this._settings.set_int(settingKey, val);
        }
      });

      box.add_child(entry);
      return item;
    }

    _buildCalendarUI() {
      this._calendarContainer.destroy_all_children();

      const displayMonth = this._calendarDisplayDate.get_month();
      const displayYear = this._calendarDisplayDate.get_year();

      const currentSettingMinutes = this._settings.get_int('work-minutes');

      // 1. Header
      let headerBox = new St.BoxLayout({ style: 'spacing: 0px;' });
      this._calendarContainer.add_child(headerBox);

      let prevButton = new St.Button({ style_class: 'button icon-button', child: new St.Icon({ icon_name: 'go-previous-symbolic', icon_size: 12 }) });
      prevButton.connect('clicked', () => this._changeCalendarMonth(-1));
      headerBox.add_child(prevButton);

      let monthLabel = new St.Label({
        text: this._calendarDisplayDate.format('%b %Y'),
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style: 'text-align: center; font-weight: bold; font-size: 0.9em;'
      });
      headerBox.add_child(monthLabel);

      let nextButton = new St.Button({ style_class: 'button icon-button', child: new St.Icon({ icon_name: 'go-next-symbolic', icon_size: 12 }) });
      nextButton.connect('clicked', () => this._changeCalendarMonth(1));
      headerBox.add_child(nextButton);

      // 2. Day Headers
      let dowBox = new St.BoxLayout({ style: 'spacing: 2px; margin-top: 5px;' });
      this._calendarContainer.add_child(dowBox);
      const dows = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
      for (const dow of dows) {
        dowBox.add_child(new St.Label({ text: dow, x_expand: true, style: 'text-align: center; width: 24px; font-size: 0.8em;' }));
      }

      // 3. Grid
      let grid = new St.BoxLayout({ vertical: true, style: 'spacing: 2px; margin-top: 2px;' });
      this._calendarContainer.add_child(grid);

      let firstDayOfMonth = GLib.DateTime.new_local(displayYear, displayMonth, 1, 0, 0, 0);
      let firstDayOfWeek = firstDayOfMonth.get_day_of_week() % 7;
      let daysInMonth = firstDayOfMonth.add_months(1).add_days(-1).get_day_of_month();

      let dayCounter = 1;
      let logicalToday = this._getLogicalDate();

      for (let i = 0; i < 6; i++) {
        if (dayCounter > daysInMonth) break;
        let currentWeekBox = new St.BoxLayout({ style: 'spacing: 2px;' });
        grid.add_child(currentWeekBox);

        for (let j = 0; j < 7; j++) {
          if (i === 0 && j < firstDayOfWeek) {
            currentWeekBox.add_child(new St.Label({ text: '', x_expand: true, style: 'width: 24px;' }));
          } else if (dayCounter <= daysInMonth) {
            let dayStr = dayCounter.toString();
            // Ensure format matches %Y-%m-%d
            let dateKey = `${displayYear}-${displayMonth.toString().padStart(2, '0')}-${dayStr.padStart(2, '0')}`;

            const historyForDay = this._completionHistory[dateKey] || [];
            const hasHistory = historyForDay.length > 0;
            const isToday = (displayYear === logicalToday.get_year() && displayMonth === logicalToday.get_month() && dayCounter === logicalToday.get_day_of_month());

            let timeString = '';
            let totalMinutes = 0;
            let taskCounts = {};

            if (hasHistory) {
              historyForDay.forEach(h => {
                const sessionDur = (h.duration !== undefined) ? h.duration : currentSettingMinutes;
                totalMinutes += sessionDur;
                taskCounts[h.taskName] = (taskCounts[h.taskName] || 0) + sessionDur;
              });

              const hours = Math.floor(totalMinutes / 60);
              const minutes = totalMinutes % 60;

              if (hours > 0) {
                timeString = `${hours}h${minutes.toString().padStart(2, '0')}m`;
              } else {
                timeString = `${minutes}m`;
              }
              if (timeString === '0m') timeString = '0m';
            }

            let boxStyle = 'width: 24px; padding: 2px; border-radius: 4px;';
            if (isToday) boxStyle += 'background-color: #3584e4; color: white;';
            else if (hasHistory) boxStyle += 'background-color: rgba(255, 255, 255, 0.1); font-weight: bold;';

            let dayContentBox = new St.BoxLayout({ vertical: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, style: boxStyle });
            dayContentBox.add_child(new St.Label({ text: dayStr, style: 'text-align: center; font-size: 0.85em;' }));
            if (timeString) dayContentBox.add_child(new St.Label({ text: timeString, style: 'text-align: center; font-size: 0.65em; opacity: 0.8;' }));

            let dayButton = new St.Button({ child: dayContentBox, reactive: true, can_focus: true, style_class: 'button', style: 'padding: 0; border: none; background-color: transparent; box-shadow: none;' });
            dayButton.connect('clicked', () => {
              if (hasHistory) {
                const hours = Math.floor(totalMinutes / 60);
                const minutes = totalMinutes % 60;
                let niceTime = (hours > 0) ? `${hours}h${minutes.toString().padStart(2, '0')}m` : `${minutes}m`;

                let msg = `Time: ${niceTime} (${historyForDay.length} sessions)\n\nTasks:\n`;
                for (let [name, minutesSpent] of Object.entries(taskCounts)) {
                  msg += `- ${name}: ${minutesSpent}m\n`;
                }
                Main.notify(`Date: ${dateKey}`, msg);
              } else {
                Main.notify(`Date: ${dateKey}`, "No sessions.");
              }
            });
            currentWeekBox.add_child(dayButton);
            dayCounter++;
          } else {
            currentWeekBox.add_child(new St.Label({ text: '', x_expand: true, style: 'width: 24px;' }));
          }
        }
      }
    }

    _changeCalendarMonth(monthOffset) {
      this._calendarDisplayDate = this._calendarDisplayDate.add_months(monthOffset);
      this._buildCalendarUI();
    }

    _rebuildTaskMenu() {
      this._taskSection.removeAll();

      let noneItem = new PopupMenu.PopupMenuItem('No Active Task');
      if (!this._activeTaskId) noneItem.setOrnament(PopupMenu.Ornament.DOT);
      noneItem.connect('activate', () => this._setActiveTask(null));
      this._taskSection.addMenuItem(noneItem);
      this._taskSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      this._tasks.forEach(task => {
        let taskItem = new PopupMenu.PopupBaseMenuItem();
        let itemBox = new St.BoxLayout({ vertical: false, x_expand: true, style: 'spacing: 10px;' });
        taskItem.add_child(itemBox);
        itemBox.add_child(new St.Label({ text: `${task.name} (${task.completed}/${task.target})`, x_expand: true }));
        let deleteButton = new St.Button({ style_class: 'button icon-button', child: new St.Icon({ icon_name: 'edit-delete-symbolic', style_class: 'popup-menu-icon' }) });
        deleteButton.connect('clicked', () => this._deleteTask(task.id));
        itemBox.add_child(deleteButton);
        taskItem.connect('activate', () => this._setActiveTask(task.id));
        if (task.id === this._activeTaskId) taskItem.setOrnament(PopupMenu.Ornament.DOT);
        this._taskSection.addMenuItem(taskItem);
      });
    }

    _resetDailyProgress() {
      this._cyclesToday = 0;
      this._tasks.forEach(task => task.completed = 0);
      this._reset();
      Main.notify('Pomodoro Timer', 'Daily progress has been reset.');
      this._updateUI();
      this._saveState();
    }

    _addTask() {
      const name = this._taskNameEntry.get_text().trim();
      const target = parseInt(this._taskIntervalsEntry.get_text(), 10);
      if (name && !isNaN(target) && target > 0) {
        const newTask = { id: GLib.uuid_string_random(), name, target, completed: 0 };
        this._tasks.push(newTask);
        this._taskNameEntry.set_text('');
        this._taskIntervalsEntry.set_text('');
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
      if (this._activeTaskId === taskId) this._activeTaskId = null;
      this._updateUI();
      this._saveState();
    }

    _sessionFinished(notifyAndSound = true) {
      if (notifyAndSound) {
        Main.notify('Pomodoro Timer', `${this._sessionType} session is over!`);
        this._playSound();
      }

      const cyclesBeforeLong = this._settings.get_int('cycles-before-long-break');
      const workMin = this._settings.get_int('work-minutes');
      const shortBreakMin = this._settings.get_int('short-break-minutes');
      const longBreakMin = this._settings.get_int('long-break-minutes');

      if (this._sessionType === Session.WORK) {
        this._workCycleCount++;
        const todayStr = this._getLogicalDate().format('%Y-%m-%d');
        const lastDate = this._settings.get_string('last-cycle-date');

        if (todayStr !== lastDate) {
          this._cyclesToday = 1;
          this._tasks.forEach(task => task.completed = 0);
        } else {
          this._cyclesToday++;
        }

        // --- UPDATED LOGIC HERE ---
        // 1. Determine Task Name/ID (Default to 'General' if no task active)
        let taskId = 'general';
        let taskName = 'General Work';

        if (this._activeTaskId) {
          const activeTask = this._tasks.find(t => t.id === this._activeTaskId);
          if (activeTask) {
            activeTask.completed++;
            taskId = activeTask.id;
            taskName = activeTask.name;
          }
        }

        // 2. Always save to history (so the calendar updates)
        if (!this._completionHistory[todayStr]) {
          this._completionHistory[todayStr] = [];
        }

        this._completionHistory[todayStr].push({
          taskId: taskId,
          taskName: taskName,
          duration: workMin // Store current duration setting
        });

        // 3. Immediately refresh calendar to show new time
        this._buildCalendarUI();

        if (this._workCycleCount >= cyclesBeforeLong) {
          this._sessionType = Session.LONG_BREAK;
          this._timeLeft = longBreakMin * 60;
          this._workCycleCount = 0;
        } else {
          this._sessionType = Session.SHORT_BREAK;
          this._timeLeft = shortBreakMin * 60;
        }
      } else {
        this._sessionType = Session.WORK;
        this._timeLeft = workMin * 60;
      }
      this._start();
    }

    _updateUI() {
      this._label.set_text(this._formatTime(this._timeLeft));
      const cyclesBeforeLong = this._settings.get_int('cycles-before-long-break');
      const progressText = `Until Long Break: ${this._workCycleCount}/${cyclesBeforeLong} | Today: ${this._cyclesToday}`;
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
      try { this._icon.gicon = new Gio.FileIcon({ file: Gio.File.new_for_path(iconPath) }); } catch (e) { this._icon.icon_name = 'dialog-error-symbolic'; }

      switch (this._state) {
        case State.RUNNING: this._startPauseItem.label.set_text('Pause'); break;
        case State.PAUSED: this._startPauseItem.label.set_text('Resume'); break;
        case State.STOPPED: this._startPauseItem.label.set_text('Start'); break;
      }
      this._rebuildTaskMenu();
    }

    _toggleTimer() { if (this._state === State.RUNNING) this._pause(); else this._start() }
    _start() { if (this._timerId) GLib.source_remove(this._timerId); this._state = State.RUNNING; this._updateUI(); this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => { this._timeLeft--; this._updateUI(); this._saveState(); if (this._timeLeft <= 0) { this._sessionFinished(); return GLib.SOURCE_REMOVE } return GLib.SOURCE_CONTINUE }) }
    _pause() { if (!this._timerId) return; this._state = State.PAUSED; GLib.source_remove(this._timerId); this._timerId = null; this._updateUI() }
    _reset() {
      if (this._timerId) { GLib.source_remove(this._timerId); this._timerId = null }
      this._state = State.STOPPED;
      this._sessionType = Session.WORK;
      this._timeLeft = this._settings.get_int('work-minutes') * 60;
      this._workCycleCount = 0;
      this._updateUI();
      this._saveState();
    }
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
