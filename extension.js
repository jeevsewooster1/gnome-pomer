import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';

// --- Constants for Pomodoro timings ---
const WORK_MINUTES = 25;
const SHORT_BREAK_MINUTES = 5;
const LONG_BREAK_MINUTES = 15;
const CYCLES_BEFORE_LONG_BREAK = 4; // <-- NEW: How many work cycles before a long break

// Convert minutes to seconds
const WORK_DURATION = WORK_MINUTES * 60;
const SHORT_BREAK_DURATION = SHORT_BREAK_MINUTES * 60;
const LONG_BREAK_DURATION = LONG_BREAK_MINUTES * 60;

// --- States for the timer ---
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

const PomodoroTimer = GObject.registerClass(
class PomodoroTimer extends PanelMenu.Button {
    constructor(extension) {
        super(0.0, 'Pomodoro Timer');

        this._extension = extension;

        // --- Initialize state variables ---
        this._state = State.STOPPED;
        this._sessionType = Session.WORK;
        this._timeLeft = WORK_DURATION;
        this._timerId = null;
        this._workCycleCount = 0;

        // --- Create the panel icon and label ---
        this._label = new St.Label({
            text: this._formatTime(this._timeLeft),
            y_align: Clutter.ActorAlign.CENTER,
        });

        // UPDATED: Make the icon bigger using icon_size
        this._icon = new St.Icon({
            style_class: 'system-status-icon',
            icon_size: 24, // <-- UPDATED: Default is ~16px. 24px is noticeably larger.
        });
        
        let box = new St.BoxLayout();
        box.add_child(this._icon);
        box.add_child(this._label);
        this.add_child(box);

        // --- Build the popup menu ---
        this._buildMenu();
        this._updateUI();
    }

    _buildMenu() {
        // --- Progress Tracker Item ---
        // <-- NEW: Add a menu item to show progress towards the long break -->
        this._progressMenuItem = new PopupMenu.PopupMenuItem('');
        this._progressMenuItem.sensitive = false; // Make it not clickable
        this.menu.addMenuItem(this._progressMenuItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // --- Control Items ---
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
        this._workCycleCount = 0; // <-- UPDATED: Reset cycle count
        this._updateUI();
    }

    _sessionFinished() {
        const notificationMessage = `${this._sessionType} session is over!`;
        Main.notify('Pomodoro Timer', notificationMessage);
        this._playSound();
        
        // UPDATED: More robust logic for cycling sessions and resetting the count
        if (this._sessionType === Session.WORK) {
            this._workCycleCount++;
            if (this._workCycleCount >= CYCLES_BEFORE_LONG_BREAK) {
                this._sessionType = Session.LONG_BREAK;
                this._timeLeft = LONG_BREAK_DURATION;
                this._workCycleCount = 0; // Reset for the next set of cycles
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

    _playSound() {
        const soundFile = this._extension.path + '/assets/audio/ring.mp3';
        try {
            if (Gio.File.new_for_path(soundFile).query_exists(null)) {
                GLib.spawn_command_line_async(`paplay ${soundFile}`);
            } else {
                Main.notify('Pomodoro Timer', 'Sound file not found.');
            }
        } catch (e) {
            logError(e, 'Failed to play sound');
        }
    }

    _formatTime(seconds) {
        let mins = Math.floor(seconds / 60);
        let secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    _updateUI() {
        // Update timer label
        this._label.set_text(this._formatTime(this._timeLeft));

        // <-- NEW: Update the progress tracker text -->
        const progressText = `Until Long Break: ${this._workCycleCount} / ${CYCLES_BEFORE_LONG_BREAK}`;
        this._progressMenuItem.label.set_text(progressText);

        // Update icon based on session type
        const iconName = (this._sessionType === Session.WORK) ? 'work.png' : 'rest.png';
        const iconPath = this._extension.path + `/assets/img/${iconName}`;
        try {
            const file = Gio.File.new_for_path(iconPath);
            if (this._icon.gicon?.get_file()?.get_path() !== file.get_path()) {
                this._icon.gicon = new Gio.FileIcon({ file });
            }
        } catch (e) {
            logError(e, `Failed to load icon: ${iconName}`);
            this._icon.icon_name = 'dialog-error-symbolic';
        }

        // Update menu item text based on state
        switch (this._state) {
            case State.RUNNING:
                this._startPauseItem.label.set_text('Pause');
                break;
            case State.PAUSED:
                this._startPauseItem.label.set_text('Resume');
                break;
            case State.STOPPED:
                this._startPauseItem.label.set_text('Start');
                break;
        }
    }

    destroy() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
        }
        super.destroy();
    }
});

export default class PomodoroExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._indicator = null;
    }

    enable() {
        this._indicator = new PomodoroTimer(this);
        Main.panel.addToStatusArea('pomodoro-timer', this._indicator);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}
