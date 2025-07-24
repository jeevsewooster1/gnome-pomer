import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter'; // <-- FIX 1: Import Clutter

// --- Constants for Pomodoro timings ---
const WORK_MINUTES = 25;
const SHORT_BREAK_MINUTES = 5;
const LONG_BREAK_MINUTES = 15;

// Convert minutes to seconds for GLib.timeout_add_seconds
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
    constructor() {
        super(0.0, 'Pomodoro Timer');

        // --- Initialize state variables ---
        this._state = State.STOPPED;
        this._sessionType = Session.WORK;
        this._timeLeft = WORK_DURATION;
        this._timerId = null;
        this._workCycleCount = 0;

        // --- Create the panel icon and label ---
        this._label = new St.Label({
            text: this._formatTime(this._timeLeft),
            y_align: Clutter.ActorAlign.CENTER, // <-- FIX 2: Use Clutter.ActorAlign
        });

        this._icon = new St.Icon({
            icon_name: 'media-playback-start-symbolic',
            style_class: 'system-status-icon',
        });
        
        let box = new St.BoxLayout();
        box.add_child(this._icon);
        box.add_child(this._label);
        this.add_child(box);

        // --- Build the popup menu ---
        this._buildMenu();
    }

    _buildMenu() {
        // --- Start/Pause Item ---
        this._startPauseItem = new PopupMenu.PopupMenuItem('Start');
        this._startPauseItem.connect('activate', () => this._toggleTimer());
        this.menu.addMenuItem(this._startPauseItem);

        // --- Reset Item ---
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

        // Start a timer that ticks every second
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._timeLeft--;
            this._updateUI();

            if (this._timeLeft <= 0) {
                this._sessionFinished();
                return GLib.SOURCE_REMOVE; // Stop the timer
            }
            return GLib.SOURCE_CONTINUE; // Continue ticking
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

    _sessionFinished() {
        const notificationMessage = `${this._sessionType} session is over!`;
        Main.notify('Pomodoro Timer', notificationMessage);
        
        if (this._sessionType === Session.WORK) {
            this._workCycleCount++;
            if (this._workCycleCount % 4 === 0) {
                this._sessionType = Session.LONG_BREAK;
                this._timeLeft = LONG_BREAK_DURATION;
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

        switch (this._state) {
            case State.RUNNING:
                this._icon.icon_name = 'media-playback-pause-symbolic';
                this._startPauseItem.label.set_text('Pause');
                break;
            case State.PAUSED:
                this._icon.icon_name = 'media-playback-start-symbolic';
                this._startPauseItem.label.set_text('Resume');
                break;
            case State.STOPPED:
                this._icon.icon_name = 'media-playback-start-symbolic';
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
        this._indicator = new PomodoroTimer();
        Main.panel.addToStatusArea('pomodoro-timer', this._indicator);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}
