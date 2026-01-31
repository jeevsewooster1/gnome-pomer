import GLib from 'gi://GLib';
import { Settings } from './constants.js';

export class Storage {
  constructor(settings) {
    this._settings = settings;
  }

  get workMinutes() { return this._settings.get_int(Settings.WORK_MINUTES); }
  get shortBreakMinutes() { return this._settings.get_int(Settings.SHORT_BREAK_MINUTES); }
  get longBreakMinutes() { return this._settings.get_int(Settings.LONG_BREAK_MINUTES); }
  get cyclesBeforeLongBreak() { return this._settings.get_int(Settings.CYCLES_BEFORE_LONG_BREAK); }

  getTimerState() {
    return {
      state: this._settings.get_int(Settings.TIMER_STATE),
      timeLeft: this._settings.get_int(Settings.TIME_LEFT),
      workCycleCount: this._settings.get_int(Settings.WORK_CYCLE_COUNT),
      sessionType: this._settings.get_string(Settings.SESSION_TYPE),
      activeTaskId: this._settings.get_string(Settings.ACTIVE_TASK_ID),
      cyclesToday: this._settings.get_int(Settings.CYCLES_TODAY),
      lastDate: this._settings.get_string(Settings.LAST_CYCLE_DATE)
    };
  }

  saveTimerState(stateData) {
    this._settings.set_int(Settings.TIMER_STATE, stateData.state);
    this._settings.set_int(Settings.TIME_LEFT, stateData.timeLeft);
    this._settings.set_int(Settings.WORK_CYCLE_COUNT, stateData.workCycleCount);
    this._settings.set_string(Settings.SESSION_TYPE, stateData.sessionType);
    this._settings.set_string(Settings.ACTIVE_TASK_ID, stateData.activeTaskId || '');
    this._settings.set_int(Settings.CYCLES_TODAY, stateData.cyclesToday);
    this._settings.set_string(Settings.LAST_CYCLE_DATE, stateData.lastDate);
    this._settings.set_int64(Settings.QUIT_TIME, GLib.get_monotonic_time());
  }

  getTasks() {
    const tasksJson = this._settings.get_strv(Settings.TASKS);
    return tasksJson.map(json => {
      try { return JSON.parse(json); } catch (e) { return null; }
    }).filter(task => task !== null);
  }

  saveTasks(tasks) {
    const tasksJson = tasks.map(task => JSON.stringify(task));
    this._settings.set_strv(Settings.TASKS, tasksJson);
  }

  getHistory() {
    try {
      const historyJson = this._settings.get_string(Settings.COMPLETION_HISTORY);
      return historyJson ? JSON.parse(historyJson) : {};
    } catch (e) {
      return {};
    }
  }

  saveHistory(history) {
    this._settings.set_string(Settings.COMPLETION_HISTORY, JSON.stringify(history));
  }
}
