import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Storage } from './storage.js';
import { SyncService } from './syncService.js';
import { HistoryView } from './ui/historyView.js';
import { TaskView } from './ui/taskView.js';
import { getLogicalDate, formatTime, playSound } from './utils.js';
import { State, Session, Settings, LOGICAL_DAY_OFFSET } from './constants.js';

export const PomodoroTimer = GObject.registerClass(
  class PomodoroTimer extends PanelMenu.Button {
    constructor(extension, settings) {
      super(0.0, 'Pomodoro Timer');

      this._extension = extension;
      this._storage = new Storage(settings);
      this._settings = settings;
      this._syncService = new SyncService(extension.path);

      this._state = State.STOPPED;
      this._sessionType = Session.WORK;
      this._timeLeft = this._storage.workMinutes * 60;
      this._timerId = null;
      this._workCycleCount = 0;
      this._cyclesToday = 0;

      this._tasks = [];
      this._activeTaskId = null;
      this._completionHistory = {};

      this._label = new St.Label({
        text: formatTime(this._timeLeft),
        y_align: Clutter.ActorAlign.CENTER
      });
      this._icon = new St.Icon({ style_class: 'system-status-icon', icon_size: 34 });

      let box = new St.BoxLayout();
      box.add_child(this._icon);
      box.add_child(this._label);
      this.add_child(box);

      this._historyView = new HistoryView();
      this._taskView = new TaskView(this.menu);

      this._setupTaskCallbacks();
      this._buildMenu();
      this._loadState();
      this._updateUI();
    }

    _setupTaskCallbacks() {
      this._taskView.setCallbacks({
        onTaskAdded: (name, target) => this._addTask(name, target),
        onTaskDeleted: (id) => this._deleteTask(id),
        onTaskSelected: (id) => this._setActiveTask(id),
        onTaskDeselected: () => this._setActiveTask(null)
      });
    }

    _loadState() {
      this._tasks = this._storage.getTasks();
      this._completionHistory = this._storage.getHistory();

      const storedState = this._storage.getTimerState();

      const todayStr = getLogicalDate().format('%Y-%m-%d');
      if (todayStr !== storedState.lastDate) {
        this._cyclesToday = 0;
        this._tasks.forEach(task => task.completed = 0);
      } else {
        this._cyclesToday = storedState.cyclesToday;
      }

      this._activeTaskId = storedState.activeTaskId;

      if (storedState.state === State.STOPPED) {
        this._reset();
        return;
      }

      this._state = (storedState.state === State.RUNNING) ? State.PAUSED : storedState.state;
      this._timeLeft = storedState.timeLeft;
      this._workCycleCount = storedState.workCycleCount;
      this._sessionType = storedState.sessionType;
    }

    _saveState() {
      this._storage.saveTimerState({
        state: this._state,
        timeLeft: this._timeLeft,
        workCycleCount: this._workCycleCount,
        sessionType: this._sessionType,
        activeTaskId: this._activeTaskId,
        cyclesToday: this._cyclesToday,
        lastDate: getLogicalDate().format('%Y-%m-%d')
      });
      this._storage.saveTasks(this._tasks);
      this._storage.saveHistory(this._completionHistory);
    }

    _buildMenu() {
      this._progressMenuItem = new PopupMenu.PopupMenuItem('');
      this._progressMenuItem.sensitive = false;
      this.menu.addMenuItem(this._progressMenuItem, 0);

      this._taskProgressMenuItem = new PopupMenu.PopupMenuItem('');
      this._taskProgressMenuItem.sensitive = false;
      this.menu.addMenuItem(this._taskProgressMenuItem, 1);

      this._syncItem = new PopupMenu.PopupMenuItem('Sync Data');
      this._syncItem.connect('activate', () => this._performSync());
      this.menu.addMenuItem(this._syncItem);

      let historyHeader = new PopupMenu.PopupMenuItem('History');
      historyHeader.sensitive = false;
      this.menu.addMenuItem(historyHeader);
      this.menu.addMenuItem(this._historyView.menuItem);
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      this._startPauseItem = new PopupMenu.PopupMenuItem('Start');
      this._startPauseItem.connect('activate', () => this._toggleTimer());
      this.menu.addMenuItem(this._startPauseItem);

      let resetItem = new PopupMenu.PopupMenuItem('Reset Timer');
      resetItem.connect('activate', () => this._reset());
      this.menu.addMenuItem(resetItem);

      // let resetDailyItem = new PopupMenu.PopupMenuItem('Reset Daily Progress');
      // resetDailyItem.connect('activate', () => this._resetDailyProgress());
      // this.menu.addMenuItem(resetDailyItem);

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      this._buildSettingsSubmenu();
    }

    _buildSettingsSubmenu() {
      let settingsSubMenu = new PopupMenu.PopupSubMenuMenuItem('Settings');
      this.menu.addMenuItem(settingsSubMenu);

      const createRow = (label, key) => {
        let item = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        let box = new St.BoxLayout({ x_expand: true, style: 'spacing: 10px;' });
        item.add_child(box);
        box.add_child(new St.Label({ text: label, y_align: Clutter.ActorAlign.CENTER, x_expand: true }));

        let entry = new St.Entry({ style: 'width: 50px; text-align: right;', can_focus: true });
        entry.set_text(this._settings.get_int(key).toString());
        entry.get_clutter_text().connect('text-changed', () => {
          let text = entry.get_text().replace(/[^0-9]/g, '');
          if (text !== entry.get_text()) entry.set_text(text);
          let val = parseInt(text, 10);
          if (!isNaN(val) && val > 0) this._settings.set_int(key, val);
        });
        box.add_child(entry);
        return item;
      };

      settingsSubMenu.menu.addMenuItem(createRow('Work (min)', Settings.WORK_MINUTES));
      settingsSubMenu.menu.addMenuItem(createRow('Short Break (min)', Settings.SHORT_BREAK_MINUTES));
      settingsSubMenu.menu.addMenuItem(createRow('Long Break (min)', Settings.LONG_BREAK_MINUTES));
      settingsSubMenu.menu.addMenuItem(createRow('Intervals per Cycle', Settings.CYCLES_BEFORE_LONG_BREAK));
    }

    _toggleTimer() {
      if (this._state === State.RUNNING) this._pause();
      else this._start();
    }

    _start() {
      if (this._timerId) GLib.source_remove(this._timerId);
      this._state = State.RUNNING;
      this._updateUI();

      this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
        this._timeLeft--;
        this._updateUI();
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
      this._timeLeft = this._storage.workMinutes * 60;
      this._workCycleCount = 0;
      this._updateUI();
      this._saveState();
    }

    _sessionFinished() {
      Main.notify('Pomodoro Timer', `${this._sessionType} session is over!`);
      playSound(this._extension.path);

      if (this._sessionType === Session.WORK) {
        this._handleWorkSessionCompletion();
      } else {
        this._sessionType = Session.WORK;
        this._timeLeft = this._storage.workMinutes * 60;
      }
      this._start();
    }

    _handleWorkSessionCompletion() {
      this._workCycleCount++;
      const todayStr = getLogicalDate().format('%Y-%m-%d');
      const lastDate = this._storage.getTimerState().lastDate;

      if (todayStr !== lastDate) {
        this._cyclesToday = 1;
        this._tasks.forEach(task => task.completed = 0);
      } else {
        this._cyclesToday++;
      }

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

      if (!this._completionHistory[todayStr]) {
        this._completionHistory[todayStr] = [];
      }
      this._completionHistory[todayStr].push({
        taskId: taskId,
        taskName: taskName,
        duration: this._storage.workMinutes
      });

      if (this._workCycleCount >= this._storage.cyclesBeforeLongBreak) {
        this._sessionType = Session.LONG_BREAK;
        this._timeLeft = this._storage.longBreakMinutes * 60;
        this._workCycleCount = 0;
      } else {
        this._sessionType = Session.SHORT_BREAK;
        this._timeLeft = this._storage.shortBreakMinutes * 60;
      }
    }

    _addTask(name, target) {
      const newTask = { id: GLib.uuid_string_random(), name, target, completed: 0 };
      this._tasks.push(newTask);
      this._setActiveTask(newTask.id);
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

    _resetDailyProgress() {
      this._cyclesToday = 0;
      this._tasks.forEach(task => task.completed = 0);
      this._reset();
      Main.notify('Pomodoro Timer', 'Daily progress has been reset.');
    }

    _updateUI() {
      this._label.set_text(formatTime(this._timeLeft));

      const iconName = (this._sessionType === Session.WORK) ? 'work.png' : 'rest.png';
      const iconPath = this._extension.path + `/assets/img/${iconName}`;
      try {
        this._icon.gicon = new Gio.FileIcon({ file: Gio.File.new_for_path(iconPath) });
      } catch (e) {
        this._icon.icon_name = 'dialog-error-symbolic';
      }

      const cyclesBeforeLong = this._storage.cyclesBeforeLongBreak;
      this._progressMenuItem.label.set_text(
        `Until Long Break: ${this._workCycleCount}/${cyclesBeforeLong} | Today: ${this._cyclesToday}`
      );

      let activeTask = this._activeTaskId ? this._tasks.find(t => t.id === this._activeTaskId) : null;
      if (activeTask) {
        this._taskProgressMenuItem.label.set_text(`Active: ${activeTask.name} (${activeTask.completed}/${activeTask.target})`);
        this._taskProgressMenuItem.show();
      } else {
        this._taskProgressMenuItem.hide();
      }

      switch (this._state) {
        case State.RUNNING: this._startPauseItem.label.set_text('Pause'); break;
        case State.PAUSED: this._startPauseItem.label.set_text('Resume'); break;
        case State.STOPPED: this._startPauseItem.label.set_text('Start'); break;
      }

      this._taskView.update(this._tasks, this._activeTaskId);
      this._historyView.update(this._completionHistory, this._storage.workMinutes);
    }

    destroy() {
      if (this._timerId) {
        GLib.source_remove(this._timerId);
        this._timerId = null;
      }
      this._saveState();
      super.destroy();
    }

    async _performSync() {
      this._syncItem.setSensitive(false);
      this._syncItem.label.set_text('Syncing...');

      try {
        // 1. Get the REAL modification time from storage
        const lastModified = this._storage.lastUpdated;

        const fullLocalData = {
          timerState: this._storage.getTimerState(),
          tasks: this._tasks,
          history: this._completionHistory,
          // We send the internal storage timestamp, NOT Date.now()
          updatedAt: lastModified
        };

        // 2. Send to Server (Note: we pass fullLocalData directly to sync service)
        // You might need to tweak syncService.js to use fullLocalData.updatedAt
        // OR update syncService to accept (data, timestamp)
        const result = await this._syncService.sync(fullLocalData);

        // 3. Handle Result
        if (result.serverData) {
          // Server had newer data. The server sends back the payload.
          const remote = result.serverData.payload;

          // IMPORTANT: When we load remote data, we DO NOT update the timestamp
          // to "now", we want to keep the server's timestamp or just save data 
          // without triggering a new 'setLastUpdated' if possible.
          // However, for simplicity, we just save it.

          if (remote.timerState) this._storage.saveTimerState(remote.timerState);
          if (remote.tasks) this._storage.saveTasks(remote.tasks);
          if (remote.history) this._storage.saveHistory(remote.history);

          // Reload logic
          this._loadState();
          this._updateUI();
          Main.notify('Pomodoro Sync', 'Data downloaded from Server');
        } else {
          // Server accepted our data
          Main.notify('Pomodoro Sync', 'Upload Successful');
        }

      } catch (e) {
        global.log(e); // Check "Journal" in Gnome Logs if this fails
        Main.notify('Sync Error', e.message);
      } finally {
        this._syncItem.setSensitive(true);
        this._syncItem.label.set_text('Sync Data');
      }
    }
  }
);
