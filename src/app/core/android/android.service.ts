import {Injectable} from '@angular/core';
import {Task} from '../../features/tasks/task.model';
import {Observable} from 'rxjs';
import {TagService} from '../../features/tag/tag.service';
import {TaskService} from '../../features/tasks/task.service';
import {TODAY_TAG} from '../../features/tag/tag.const';
import {map, switchMap} from 'rxjs/operators';
import {androidInterface} from './android-interface';
import {DataInitService} from '../data-init/data-init.service';

@Injectable({
  providedIn: 'root'
})
export class AndroidService {
  private _todayTagTasksFlat$: Observable<Task[]> = this._dataInitService.isAllDataLoadedInitially$.pipe(
    switchMap(() => this._tagService.getTagById$(TODAY_TAG.id)),
    switchMap(tag => this._taskService.getByIdsLive$(tag.taskIds)),
    map(tasks => tasks && tasks.sort((a, b) => (a.isDone === b.isDone)
      ? 0
      : (a.isDone ? 1 : -1)
    )),
  );

  constructor(
    private _dataInitService: DataInitService,
    private _tagService: TagService,
    private _taskService: TaskService,
  ) {
    // this._todayTagTasksFlat$.subscribe((v) => console.log('_todayTagTasksFlat$', v));
    // this._todayTagTasksFlat$.subscribe((tasks) => console.log(tasks.map((value, index) => value.isDone)));
  }

  init() {
    this._todayTagTasksFlat$.subscribe(tasks => {
      androidInterface.updateTaskData(JSON.stringify(tasks));
    });
  }
}
