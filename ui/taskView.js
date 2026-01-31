import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class TaskView {
  constructor(menu) {
    this._menu = menu;
    this._callbacks = {
      onTaskAdded: null,
      onTaskDeleted: null,
      onTaskSelected: null,
      onTaskDeselected: null
    };

    this._tasks = [];
    this._activeTaskId = null;

    this._buildUI();
  }

  setCallbacks(callbacks) {
    this._callbacks = { ...this._callbacks, ...callbacks };
  }

  update(tasks, activeTaskId) {
    this._tasks = tasks;
    this._activeTaskId = activeTaskId;
    this._updateNoTaskItem();
    this._rebuildTaskList();
  }

  _buildUI() {
    // 1. Task Section Header
    this._taskSection = new PopupMenu.PopupMenuSection();
    this._menu.addMenuItem(this._taskSection);

    // 2. "No Active Task" Item
    this._noTaskItem = new PopupMenu.PopupMenuItem('No Active Task');
    this._noTaskItem.connect('activate', () => {
      if (this._callbacks.onTaskDeselected) this._callbacks.onTaskDeselected();
    });
    this._taskSection.addMenuItem(this._noTaskItem);

    this._taskSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    // 3. Scrollable Task List
    this._taskListScrollItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
    let containerBox = new St.BoxLayout({ vertical: true, x_expand: true });

    this._taskScrollView = new St.ScrollView({
      hscrollbar_policy: St.PolicyType.NEVER,
      vscrollbar_policy: St.PolicyType.AUTOMATIC,
      enable_mouse_scrolling: true,
      style_class: 'vfade',
      style: 'max-height: 200px;'
    });

    this._taskList = new St.BoxLayout({ vertical: true, x_expand: true });
    this._taskScrollView.set_child(this._taskList);
    containerBox.add_child(this._taskScrollView);
    this._taskListScrollItem.add_child(containerBox);
    this._taskSection.addMenuItem(this._taskListScrollItem);

    // 4. Add Task UI
    let addTaskSeparator = new PopupMenu.PopupSeparatorMenuItem("ADD NEW TASK");
    this._menu.addMenuItem(addTaskSeparator);

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
    addTaskButton.connect('clicked', () => this._handleAddTask());
    taskBox.add_child(addTaskButton);
    this._menu.addMenuItem(addTaskItem);

    this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
  }

  _handleAddTask() {
    const name = this._taskNameEntry.get_text().trim();
    const target = parseInt(this._taskIntervalsEntry.get_text(), 10);

    if (name && !isNaN(target) && target > 0) {
      this._taskNameEntry.set_text('');
      this._taskIntervalsEntry.set_text('');
      if (this._callbacks.onTaskAdded) {
        this._callbacks.onTaskAdded(name, target);
      }
    } else {
      Main.notify('Pomodoro Timer', 'Please provide a valid name and positive number.');
    }
  }

  _updateNoTaskItem() {
    if (!this._activeTaskId) {
      this._noTaskItem.setOrnament(PopupMenu.Ornament.DOT);
    } else {
      this._noTaskItem.setOrnament(PopupMenu.Ornament.NONE);
    }
  }

  _rebuildTaskList() {
    if (this._tasks.length === 0) {
      this._taskListScrollItem.hide();
      return;
    }
    this._taskListScrollItem.show();

    let savedScroll = this._taskScrollView.vadjustment.value;
    this._taskList.destroy_all_children();

    this._tasks.forEach(task => {
      let taskRow = new St.Button({
        style_class: 'popup-menu-item',
        x_expand: true,
        can_focus: true,
        style: 'border-radius: 0;'
      });

      let rowBox = new St.BoxLayout({ style: 'spacing: 10px;', x_expand: true });
      taskRow.set_child(rowBox);

      let isSelected = (task.id === this._activeTaskId);
      let iconName = isSelected ? 'object-select-symbolic' : '';

      let ornamentIcon = new St.Icon({
        icon_name: iconName,
        icon_size: 14,
        style: 'width: 16px;'
      });
      rowBox.add_child(ornamentIcon);

      let label = new St.Label({
        text: `${task.name} (${task.completed}/${task.target})`,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER
      });
      rowBox.add_child(label);

      let deleteButton = new St.Button({
        style_class: 'button icon-button',
        child: new St.Icon({ icon_name: 'edit-delete-symbolic', style_class: 'popup-menu-icon' })
      });

      deleteButton.connect('clicked', () => {
        if (this._callbacks.onTaskDeleted) this._callbacks.onTaskDeleted(task.id);
      });
      rowBox.add_child(deleteButton);

      taskRow.connect('clicked', () => {
        if (this._callbacks.onTaskSelected) this._callbacks.onTaskSelected(task.id);
      });

      this._taskList.add_child(taskRow);
    });

    if (savedScroll > 0) {
      GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        if (this._taskScrollView) {
          this._taskScrollView.vadjustment.set_value(savedScroll);
        }
        return GLib.SOURCE_REMOVE;
      });
    }
  }
}
