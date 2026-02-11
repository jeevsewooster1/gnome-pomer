import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { getLogicalDate } from '../utils.js';

export class HistoryView {
  constructor() {
    this._displayDate = getLogicalDate();
    this._historyData = {};
    this._defaultDuration = 25; // Fallback

    // Container for the whole calendar section
    this._container = new St.BoxLayout({ vertical: true, style: 'padding: 5px; spacing: 2px;' });

    // The menu item that hosts the container
    this.menuItem = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false
    });
    this.menuItem.add_child(this._container);

    // Initial build
    this._buildUI();
  }

  update(history, defaultWorkMinutes) {
    this._historyData = history || {};
    this._defaultDuration = defaultWorkMinutes;
    this._buildUI();
  }

  _buildUI() {
    this._container.destroy_all_children();

    const displayMonth = this._displayDate.get_month();
    const displayYear = this._displayDate.get_year();

    // 1. Header (Month Year + Navigation)
    let headerBox = new St.BoxLayout({ style: 'spacing: 0px;' });
    this._container.add_child(headerBox);

    let prevButton = new St.Button({
      style_class: 'button icon-button',
      child: new St.Icon({ icon_name: 'go-previous-symbolic', icon_size: 12 })
    });
    prevButton.connect('clicked', () => this._changeMonth(-1));
    headerBox.add_child(prevButton);

    let monthLabel = new St.Label({
      text: this._displayDate.format('%b %Y'),
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
      style: 'text-align: center; font-weight: bold; font-size: 0.9em;'
    });
    headerBox.add_child(monthLabel);

    let nextButton = new St.Button({
      style_class: 'button icon-button',
      child: new St.Icon({ icon_name: 'go-next-symbolic', icon_size: 12 })
    });
    nextButton.connect('clicked', () => this._changeMonth(1));
    headerBox.add_child(nextButton);

    // 2. Day Headers (S M T W T F S)
    let dowBox = new St.BoxLayout({ style: 'spacing: 2px; margin-top: 5px;' });
    this._container.add_child(dowBox);
    const dows = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    for (const dow of dows) {
      dowBox.add_child(new St.Label({
        text: dow,
        x_expand: true,
        style: 'text-align: center; width: 24px; font-size: 0.8em;'
      }));
    }

    // 3. Grid
    let grid = new St.BoxLayout({ vertical: true, style: 'spacing: 2px; margin-top: 2px;' });
    this._container.add_child(grid);

    let firstDayOfMonth = GLib.DateTime.new_local(displayYear, displayMonth, 1, 0, 0, 0);
    let firstDayOfWeek = firstDayOfMonth.get_day_of_week() % 7;
    let daysInMonth = firstDayOfMonth.add_months(1).add_days(-1).get_day_of_month();

    let dayCounter = 1;
    let logicalToday = getLogicalDate();

    for (let i = 0; i < 6; i++) {
      if (dayCounter > daysInMonth) break;
      let currentWeekBox = new St.BoxLayout({ style: 'spacing: 2px;' });
      grid.add_child(currentWeekBox);

      for (let j = 0; j < 7; j++) {
        // Empty slots before start of month
        if (i === 0 && j < firstDayOfWeek) {
          currentWeekBox.add_child(new St.Label({ text: '', x_expand: true, style: 'width: 24px;' }));
        } else if (dayCounter <= daysInMonth) {
          this._renderDayCell(currentWeekBox, displayYear, displayMonth, dayCounter, logicalToday);
          dayCounter++;
        } else {
          // Empty slots after end of month
          currentWeekBox.add_child(new St.Label({ text: '', x_expand: true, style: 'width: 24px;' }));
        }
      }
    }
  }

  _renderDayCell(container, year, month, day, today) {
    let dayStr = day.toString();
    // Ensure format matches %Y-%m-%d
    let dateKey = `${year}-${month.toString().padStart(2, '0')}-${dayStr.padStart(2, '0')}`;

    const historyForDay = this._historyData[dateKey] || [];
    const hasHistory = historyForDay.length > 0;
    const isToday = (year === today.get_year() && month === today.get_month() && day === today.get_day_of_month());

    let timeString = '';
    let totalMinutes = 0;
    let taskCounts = {};

    if (hasHistory) {
      historyForDay.forEach(h => {
        const sessionDur = (h.duration !== undefined) ? h.duration : this._defaultDuration;
        totalMinutes += sessionDur;
        taskCounts[h.taskName] = (taskCounts[h.taskName] || 0) + sessionDur;
      });

      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      timeString = (hours > 0) ? `${hours}h${minutes.toString().padStart(2, '0')}` : `${minutes}`;
      if (timeString === '0m') timeString = '0m';
    }

    let boxStyle = 'width: 24px; padding: 2px; border-radius: 4px;';
    if (isToday) boxStyle += 'background-color: #3584e4; color: white;';
    else if (hasHistory) boxStyle += 'background-color: rgba(255, 255, 255, 0.1); font-weight: bold;';

    let dayContentBox = new St.BoxLayout({
      vertical: true,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
      style: boxStyle
    });
    dayContentBox.add_child(new St.Label({ text: dayStr, style: 'text-align: center; font-size: 0.85em;' }));

    if (timeString) {
      dayContentBox.add_child(new St.Label({
        text: timeString,
        style: 'text-align: center; font-size: 0.65em; opacity: 0.8;'
      }));
    }

    let dayButton = new St.Button({
      child: dayContentBox,
      reactive: true,
      can_focus: true,
      style_class: 'button',
      style: 'padding: 0; border: none; background-color: transparent; box-shadow: none;'
    });

    dayButton.connect('clicked', () => {
      if (hasHistory) {
        this._showDayDetails(dateKey, totalMinutes, taskCounts, historyForDay.length);
      } else {
        Main.notify(`Date: ${dateKey}`, "No sessions.");
      }
    });

    container.add_child(dayButton);
  }

  _showDayDetails(dateKey, totalMinutes, taskCounts, sessionCount) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    let niceTime = (hours > 0) ? `${hours}h${minutes.toString().padStart(2, '0')}m` : `${minutes}m`;

    let msg = `Time: ${niceTime} (${sessionCount} sessions)\n\nTasks:\n`;
    for (let [name, minutesSpent] of Object.entries(taskCounts)) {
      msg += `- ${name}: ${minutesSpent}m\n`;
    }
    Main.notify(`Date: ${dateKey}`, msg);
  }

  _changeMonth(offset) {
    this._displayDate = this._displayDate.add_months(offset);
    this._buildUI();
  }
}
