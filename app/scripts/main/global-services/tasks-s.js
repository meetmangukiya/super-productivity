/**
 * @ngdoc service
 * @name superProductivity.Tasks
 * @description
 * # Tasks
 * Service in the superProductivity.
 */

(function () {
  'use strict';

  angular
    .module('superProductivity')
    .service('Tasks', Tasks);

  /* @ngInject */
  function Tasks($localStorage, Uid, $window, $rootScope, Dialogs, IS_ELECTRON, $mdToast, SimpleToast, Notifier, ShortSyntax, ParseDuration) {
    const IPC_EVENT_IDLE = 'WAS_IDLE';
    const IPC_EVENT_UPDATE_TIME_SPEND_FOR_CURRENT = 'UPDATE_TIME_SPEND';
    const IPC_EVENT_CURRENT_TASK_UPDATED = 'CHANGED_CURRENT_TASK';
    const WORKLOG_DATE_STR_FORMAT = 'YYYY-MM-DD';

    // export
    this.WORKLOG_DATE_STR_FORMAT = WORKLOG_DATE_STR_FORMAT;

    const moment = $window.moment;
    const _ = $window._;

    let isShowTakeBreakNotification = true;

    // SETUP HANDLERS FOR ELECTRON EVENTS
    if (IS_ELECTRON) {
      let that = this;

      // handler for time spent tracking
      window.ipcRenderer.on(IPC_EVENT_UPDATE_TIME_SPEND_FOR_CURRENT, (ev, evData) => {
        let timeSpentInMs = evData.timeSpentInMs;
        let idleTimeInMs = evData.idleTimeInMs;

        // only track if there is a task
        if ($rootScope.r.currentTask) {

          that.addTimeSpent($rootScope.r.currentTask, timeSpentInMs);
          that.updateCurrent($rootScope.r.currentTask, true);
          that.checkTakeToTakeABreak(timeSpentInMs, idleTimeInMs);

          // we need to manually call apply as this is an outside event
          $rootScope.$apply();
        }
      });

      // handler for idle event
      window.ipcRenderer.on(IPC_EVENT_IDLE, (ev, idleTime) => {
        // do not show as long as the user hasn't decided
        isShowTakeBreakNotification = false;

        Dialogs('WAS_IDLE', { idleTime: idleTime })
          .then(() => {
            // if tracked
            this.checkTakeToTakeABreak(idleTime);
            isShowTakeBreakNotification = true;
          }, () => {
            // if not tracked
            // unset currentSession.timeWorkedWithoutBreak
            $rootScope.r.currentSession.timeWorkedWithoutBreak = undefined;
            isShowTakeBreakNotification = true;
          });
      });
    }

    this.checkTakeToTakeABreak = (timeSpentInMs, idleTimeInMs) => {
      const MIN_IDLE_VAL_TO_TAKE_A_BREAK_FROM_TAKE_A_BREAK = 9999;

      if ($rootScope.r.config && $rootScope.r.config.isTakeABreakEnabled) {
        if (!$rootScope.r.currentSession) {
          $rootScope.r.currentSession = {};
        }
        // add or create moment duration for timeWorkedWithoutBreak
        if ($rootScope.r.currentSession.timeWorkedWithoutBreak) {
          // convert to moment to be save
          $rootScope.r.currentSession.timeWorkedWithoutBreak = moment.duration($rootScope.r.currentSession.timeWorkedWithoutBreak);
          $rootScope.r.currentSession.timeWorkedWithoutBreak.add(moment.duration({ milliseconds: timeSpentInMs }));
        } else {
          $rootScope.r.currentSession.timeWorkedWithoutBreak = moment.duration(timeSpentInMs);
        }

        if (moment.duration($rootScope.r.config.takeABreakMinWorkingTime)
            .asSeconds() < $rootScope.r.currentSession.timeWorkedWithoutBreak.asSeconds()) {

          if (idleTimeInMs > MIN_IDLE_VAL_TO_TAKE_A_BREAK_FROM_TAKE_A_BREAK) {
            return;
          }

          if (isShowTakeBreakNotification) {
            let toast = $mdToast.simple()
              .textContent('Take a break! You have been working for ' + ParseDuration.toString($rootScope.r.currentSession.timeWorkedWithoutBreak) + ' without one. Go away from the computer! Makes you more productive in the long run!')
              .action('I already did!')
              .hideDelay(20000)
              .position('bottom');
            $mdToast.show(toast).then(function (response) {
              if (response === 'ok') {
                // re-add task on undo
                $rootScope.r.currentSession.timeWorkedWithoutBreak = undefined;
              }
            });

            Notifier({
              title: 'Take a break!',
              message: 'Take a break! You have been working for ' + ParseDuration.toString($rootScope.r.currentSession.timeWorkedWithoutBreak) + ' without one. Go away from the computer! Makes you more productive in the long run!',
              sound: true,
              wait: true
            });
          }
        }
      }
    };

    this.addTimeSpent = (task, timeSpentInMsOrMomentDuration) => {
      let timeSpentCalculatedTotal;
      let timeSpentCalculatedOnDay;
      let timeSpentInMs;
      let parentTask;

      if (timeSpentInMsOrMomentDuration.asMilliseconds) {
        timeSpentInMs = timeSpentInMsOrMomentDuration.asMilliseconds();
      } else {
        timeSpentInMs = timeSpentInMsOrMomentDuration;
      }

      // use mysql date as it is sortable
      let todayStr = getTodayStr();

      // if not set set started pointer
      if (!task.started) {
        task.started = moment();
      }

      // track total time spent
      if (task.timeSpent) {
        timeSpentCalculatedTotal = moment.duration(task.timeSpent);
        timeSpentCalculatedTotal.add(moment.duration({ milliseconds: timeSpentInMs }));
      } else {
        timeSpentCalculatedTotal = moment.duration(timeSpentInMs);
      }

      // track time spent on days
      if (!task.timeSpentOnDay) {
        task.timeSpentOnDay = {};
      }
      if (task.timeSpentOnDay[todayStr]) {
        timeSpentCalculatedOnDay = moment.duration(task.timeSpentOnDay[todayStr]);
        timeSpentCalculatedOnDay.add(moment.duration({ milliseconds: timeSpentInMs }));
      } else {
        timeSpentCalculatedOnDay = moment.duration(timeSpentInMs);
      }

      // assign values
      task.timeSpent = timeSpentCalculatedTotal;
      task.timeSpentOnDay[todayStr] = timeSpentCalculatedOnDay;

      task.lastWorkedOn = moment();

      // do the same for the parent, in case the sub tasks are deleted
      if (task.parentId) {
        let timeSpentCalculatedOnDayForParent;
        parentTask = this.getById(task.parentId);
        // also set parent task to started if there is one
        if (!parentTask.started) {
          parentTask.started = moment();
        }

        // also track time spent on day for parent task
        if (parentTask.timeSpentOnDay[todayStr]) {
          timeSpentCalculatedOnDayForParent = moment.duration(parentTask.timeSpentOnDay[todayStr]);
          timeSpentCalculatedOnDayForParent.add(moment.duration({ milliseconds: timeSpentInMs }));
        } else {
          timeSpentCalculatedOnDayForParent = moment.duration(timeSpentInMs);
        }

        parentTask.timeSpentOnDay[todayStr] = timeSpentCalculatedOnDayForParent;
        parentTask.lastWorkedOn = moment();
      }

      return task;
    };

    // UTILITY
    function convertDurationStringsToMomentForList(tasks) {
      for (let i = 0; i < tasks.length; i++) {
        let task = tasks[i];
        convertDurationStringsToMoment(task);
        if (task.subTasks && task.subTasks.length) {
          for (let j = 0; j < task.subTasks.length; j++) {
            let subTask = task.subTasks[j];
            convertDurationStringsToMoment(subTask);
          }
        }
      }
    }

    function convertDurationStringsToMoment(task) {
      if (task.timeSpent) {
        task.timeSpent = moment.duration(task.timeSpent);
      }
      if (task.timeEstimate) {
        task.timeEstimate = moment.duration(task.timeEstimate);
      }
      if (task.timeSpentOnDay) {
        for (let strDate in task.timeSpentOnDay) {
          task.timeSpentOnDay[strDate] = moment.duration(task.timeSpentOnDay[strDate]);
        }
      }
    }

    function getTodayStr() {
      return moment().format(WORKLOG_DATE_STR_FORMAT);
    }

    this.getTodayStr = getTodayStr;

    this.formatToWorklogDateStr = (date) => {
      if (date) {
        return moment(date).format(WORKLOG_DATE_STR_FORMAT);
      }
    };

    function deleteNullValueTasks(tasksArray) {
      return tasksArray.filter(function (item) {
        return !!item;
      });
    }

    function checkDupes(tasksArray) {
      if (tasksArray) {
        deleteNullValueTasks(tasksArray);
        let valueArr = tasksArray.map(function (item) {
          return item && item.id;
        });
        let dupeIds = [];
        let hasDupe = valueArr.some(function (item, idx) {
          if (valueArr.indexOf(item) !== idx) {
            dupeIds.push(item);
          }
          return valueArr.indexOf(item) !== idx;
        });
        if (dupeIds.length) {
          let firstDupe = _.find(tasksArray, (task) => {
            return dupeIds.indexOf(task.id) > -1;
          });
          console.log(firstDupe);

          SimpleToast('!!! Dupes detected in data for the ids: ' + dupeIds.join(', ') + '. First task title is "' + firstDupe.title + '" !!!', 60000);
        }
        return hasDupe;
      }
    }

    this.calcTotalEstimate = (tasks) => {
      let totalEstimate;
      if (angular.isArray(tasks) && tasks.length > 0) {
        totalEstimate = moment.duration();

        for (let i = 0; i < tasks.length; i++) {
          let task = tasks[i];
          totalEstimate.add(task.timeEstimate);
        }
      }
      return totalEstimate;
    };

    this.calcTotalTimeSpent = (tasks) => {
      let totalTimeSpent;
      if (angular.isArray(tasks) && tasks.length > 0) {
        totalTimeSpent = moment.duration();

        for (let i = 0; i < tasks.length; i++) {
          let task = tasks[i];
          if (task && task.timeSpent) {
            totalTimeSpent.add(task.timeSpent);
          }
        }
      }
      return totalTimeSpent;
    };

    this.calcTotalTimeSpentOnTask = (task) => {
      let totalTimeSpent = moment.duration();
      if (task) {
        for (let key in task.timeSpentOnDay) {
          if (task.timeSpentOnDay[key]) {
            totalTimeSpent.add(moment.duration(task.timeSpentOnDay[key]).asSeconds(), 's');
          }
        }
        if (totalTimeSpent.asMinutes() > 0) {
          return totalTimeSpent;
        } else {
          return undefined;
        }
      }
    };

    this.calcRemainingTime = (tasks) => {
      let totalRemaining;
      if (angular.isArray(tasks) && tasks.length > 0) {
        totalRemaining = moment.duration();

        for (let i = 0; i < tasks.length; i++) {
          let task = tasks[i];
          if (task) {
            if (task.timeSpent && task.timeEstimate) {
              let timeSpentMilliseconds = moment.duration(task.timeSpent).asMilliseconds();
              let timeEstimateMilliseconds = moment.duration(task.timeEstimate).asMilliseconds();
              if (timeSpentMilliseconds < timeEstimateMilliseconds) {
                totalRemaining.add(moment.duration({ milliseconds: timeEstimateMilliseconds - timeSpentMilliseconds }));
              }
            } else if (task.timeEstimate) {
              totalRemaining.add(task.timeEstimate);
            }
          }
        }
      }
      return totalRemaining;

    };

    // GET DATA
    this.getCurrent = () => {
      let currentTask;
      let subTaskMatch;

      // TODO check if this is even required
      if ($localStorage.currentTask) {
        currentTask = _.find($localStorage.tasks, (task) => {
          if (task.subTasks) {
            let subTaskMatchTmp = _.find(task.subTasks, { id: $localStorage.currentTask.id });
            if (subTaskMatchTmp) {
              subTaskMatch = subTaskMatchTmp;
            }
          }
          return task.id === $localStorage.currentTask.id;
        });

        $localStorage.currentTask = $rootScope.r.currentTask = currentTask || subTaskMatch;
      }
      return $rootScope.r.currentTask;
    };

    this.getById = (taskId) => {
      return _.find($rootScope.r.tasks, ['id', taskId]) || _.find($rootScope.r.backlogTasks, ['id', taskId]) || _.find($rootScope.r.doneBacklogTasks, ['id', taskId]);
    };

    this.getBacklog = () => {
      checkDupes($localStorage.backlogTasks);
      convertDurationStringsToMomentForList($localStorage.backlogTasks);
      return $localStorage.backlogTasks;
    };

    this.getDoneBacklog = () => {
      checkDupes($localStorage.doneBacklogTasks);
      convertDurationStringsToMomentForList($localStorage.doneBacklogTasks);
      return $localStorage.doneBacklogTasks;
    };

    this.getToday = () => {
      checkDupes($localStorage.tasks);
      convertDurationStringsToMomentForList($localStorage.tasks);
      return $localStorage.tasks;
    };

    this.getAllTasks = () => {
      const todaysT = this.getToday();
      const backlogT = this.getBacklog();
      const doneBacklogT = this.getDoneBacklog();

      return _.concat(todaysT, backlogT, doneBacklogT);
    };

    this.flattenTasks = (tasks, checkFnParent, checkFnSub) => {
      const flattenedTasks = [];
      for (let i = 0; i < tasks.length; i++) {
        let parentTask = tasks[i];

        if (parentTask) {
          if (parentTask.subTasks && parentTask.subTasks.length > 0) {
            for (let j = 0; j < parentTask.subTasks.length; j++) {
              let subTask = parentTask.subTasks[j];

              // execute check fn if there is one
              if (angular.isFunction(checkFnSub)) {
                if (checkFnSub(subTask)) {
                  flattenedTasks.push(subTask);
                }
              }
              // otherwise just add
              else {
                flattenedTasks.push(subTask);
              }
            }
          } else {
            // execute check fn if there is one
            if (angular.isFunction(checkFnParent)) {
              if (checkFnParent(parentTask)) {
                flattenedTasks.push(parentTask);
              }
            }
            // otherwise just add
            else {
              flattenedTasks.push(parentTask);
            }
          }
        }
      }

      return flattenedTasks;
    };

    this.getCompleteWorkLog = () => {
      const allTasks = this.flattenTasks(this.getAllTasks());
      const worklog = {};
      for (let i = 0; i < allTasks.length; i++) {
        let task = allTasks[i];
        if (task.timeSpentOnDay) {
          for (let dateStr in task.timeSpentOnDay) {
            if (task.timeSpentOnDay[dateStr]) {
              const split = dateStr.split('-');
              const year = parseInt(split[0], 10);
              const month = parseInt(split[1], 10);
              const day = parseInt(split[2], 10);

              if (!worklog[year]) {
                worklog[year] = {
                  timeSpent: moment.duration(),
                  entries: {}
                };
              }
              if (!worklog[year].entries[month]) {
                worklog[year].entries[month] = {
                  timeSpent: moment.duration(),
                  entries: {}
                };
              }
              if (!worklog[year].entries[month].entries[day]) {
                worklog[year].entries[month].entries[day] = {
                  timeSpent: moment.duration(),
                  entries: [],
                  dateStr: dateStr,
                  id: Uid()
                };
              }

              worklog[year].entries[month].entries[day].timeSpent = worklog[year].entries[month].entries[day].timeSpent.add(task.timeSpentOnDay[dateStr]);
              worklog[year].entries[month].entries[day].entries.push({
                task: task,
                timeSpent: moment.duration(task.timeSpentOnDay[dateStr])
              });
            }
          }
        }
      }

      // calculate time spent totals once too
      for (let key in worklog) {
        let year = worklog[key];
        for (let key in year.entries) {
          let month = year.entries[key];
          for (let key in month.entries) {
            let day = month.entries[key];
            month.timeSpent = month.timeSpent.add(day.timeSpent);
          }
          year.timeSpent = year.timeSpent.add(month.timeSpent);
        }
      }

      return worklog;
    };

    this.getUndoneToday = (isSubTasksInsteadOfParent) => {
      let undoneTasks;

      // get flattened result of all undone tasks including subtasks
      if (isSubTasksInsteadOfParent) {
        // get all undone tasks tasks
        undoneTasks = this.flattenTasks($localStorage.tasks, (parentTask) => {
          return parentTask && !parentTask.isDone;
        }, (subTask) => {
          return !subTask.isDone;
        });
      }

      // just get parent undone tasks
      else {
        undoneTasks = _.filter($localStorage.tasks, (task) => {
          return task && !task.isDone;
        });
      }

      return undoneTasks;
    };

    this.getDoneToday = () => {
      return _.filter($localStorage.tasks, (task) => {
        return task && task.isDone;
      });
    };

    this.isWorkedOnToday = (task) => {
      let todayStr = getTodayStr();
      return task && task.timeSpentOnDay && task.timeSpentOnDay[todayStr];
    };

    this.getTotalTimeWorkedOnTasksToday = () => {
      let tasks = this.getToday();
      let totalTimeSpentTasks = $window.moment.duration();
      if (tasks) {
        for (let i = 0; i < tasks.length; i++) {
          let task = tasks[i];
          totalTimeSpentTasks.add(task.timeSpent);
        }
      }
      return totalTimeSpentTasks;
    };

    this.getTimeWorkedToday = () => {
      let tasks = this.getToday();
      let todayStr = getTodayStr();
      let totalTimeWorkedToday;
      if (tasks.length > 0) {
        totalTimeWorkedToday = moment.duration();
        for (let i = 0; i < tasks.length; i++) {
          let task = tasks[i];

          if (task.subTasks && task.subTasks.length) {
            for (let j = 0; j < task.subTasks.length; j++) {
              let subTask = task.subTasks[j];
              if (subTask.timeSpentOnDay && subTask.timeSpentOnDay[todayStr]) {
                totalTimeWorkedToday.add(subTask.timeSpentOnDay[todayStr]);
              }
            }
          } else {
            if (task.timeSpentOnDay && task.timeSpentOnDay[todayStr]) {
              totalTimeWorkedToday.add(task.timeSpentOnDay[todayStr]);
            }
          }
        }
      }
      return totalTimeWorkedToday;
    };

    // UPDATE DATA
    this.updateCurrent = (task, isCallFromTimeTracking) => {
      // calc progress
      if (task && task.timeSpent && task.timeEstimate) {
        if (moment.duration().format && angular.isFunction(moment.duration().format)) {
          task.progress = parseInt(moment.duration(task.timeSpent)
              .format('ss') / moment.duration(task.timeEstimate).format('ss') * 100, 10);
        }
      }

      // update totalTimeSpent for buggy macos
      if (task) {
        task.timeSpent = this.calcTotalTimeSpentOnTask(task);
      }

      // check if in electron context
      if (window.isElectron) {
        if (!isCallFromTimeTracking) {
          if (task && task.originalKey) {
            //Jira.markAsInProgress(task);
          }
        }

        if (task && task.title) {
          window.ipcRenderer.send(IPC_EVENT_CURRENT_TASK_UPDATED, task);
        }
      }

      $localStorage.currentTask = task;
      // update global pointer
      $rootScope.r.currentTask = $localStorage.currentTask;
    };

    this.setTimeSpentToday = (task, val) => {
      // add when set and not equal to current value
      if (val) {
        let todayStr = getTodayStr();
        task.lastWorkedOn = moment();
        task.timeSpentOnDay = {};
        if (!task.timeSpentOnDay[todayStr]) {
          task.timeSpentOnDay[todayStr] = val;
        }
      } else {
        // remove when unset
        task.timeSpentOnDay = {};
        if (task.lastWorkedOn) {
          delete task.lastWorkedOn;
        }
        if (task.timeSpentOnDay) {
          delete task.timeSpentOnDay;
        }
      }
    };

    this.addToday = (task) => {
      if (task && task.title) {
        $localStorage.tasks.push(this.createTask(task));

        // update global pointer for today tasks
        $rootScope.r.tasks = $localStorage.tasks;

        return true;
      }
    };

    this.createTask = (task) => {
      let transformedTask = {
        title: task.title,
        id: Uid(),
        created: moment(),
        notes: task.notes,
        parentId: task.parentId,
        timeEstimate: task.timeEstimate || task.originalEstimate,
        timeSpent: task.timeSpent || task.originalTimeSpent,
        originalId: task.originalId,
        originalKey: task.originalKey,
        originalType: task.originalType,
        originalLink: task.originalLink,
        originalStatus: task.originalStatus,
        originalEstimate: task.originalEstimate,
        originalTimeSpent: task.originalTimeSpent,
        originalAttachment: task.originalAttachment,
        originalComments: task.originalComments,
        originalUpdated: task.originalUpdated
      };
      return ShortSyntax(transformedTask);
    };

    this.updateToday = (tasks) => {
      $localStorage.tasks = tasks;
      // update global pointer
      $rootScope.r.tasks = $localStorage.tasks;
    };

    this.updateBacklog = (tasks) => {
      $localStorage.backlogTasks = tasks;
      // update global pointer
      $rootScope.r.backlogTasks = $localStorage.backlogTasks;
    };

    this.addTasksToTopOfBacklog = (tasks) => {
      $localStorage.backlogTasks = tasks.concat($localStorage.backlogTasks);
      // update global pointer
      $rootScope.r.backlogTasks = $localStorage.backlogTasks;
    };

    this.updateDoneBacklog = (tasks) => {
      $localStorage.doneBacklogTasks = tasks;
      // update global pointer
      $rootScope.r.doneBacklogTasks = $localStorage.doneBacklogTasks;
    };

    this.addDoneTasksToDoneBacklog = () => {
      let doneTasks = this.getDoneToday().slice(0);
      $localStorage.doneBacklogTasks = doneTasks.concat($localStorage.doneBacklogTasks);
      // update global pointer
      $rootScope.r.doneBacklogTasks = $localStorage.doneBacklogTasks;
    };

    this.finishDay = (clearDoneTasks, moveUnfinishedToBacklog) => {
      if (clearDoneTasks) {
        // add tasks to done backlog
        this.addDoneTasksToDoneBacklog();
        // remove done tasks from today
        this.updateToday(this.getUndoneToday());
      }

      if (moveUnfinishedToBacklog) {
        this.addTasksToTopOfBacklog(this.getUndoneToday());
        if (clearDoneTasks) {
          this.updateToday([]);
        } else {
          this.updateToday(this.getDoneToday());
        }
      }

      // also remove the current task to prevent time tracking
      this.updateCurrent(null);
    };
  }

})();
