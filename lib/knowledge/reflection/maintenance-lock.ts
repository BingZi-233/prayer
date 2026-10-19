import type { Repo } from "../../core/db/repo"

const root = globalThis as typeof globalThis & {
  __prayerReflectionMaintenance?: WeakMap<object, Promise<unknown>>
}
const queues =
  root.__prayerReflectionMaintenance ??
  (root.__prayerReflectionMaintenance = new WeakMap())

// ponytail: 仅协调本进程的共享连接；多进程写入需改为数据库租约。

export function reflectionMaintenanceKey(repo: Repo): object {
  return repo.coordinationKey ?? repo
}

/** 串行执行完整反思任务，避免升格使正在整理的快照失效。 */
export function withReflectionMaintenanceLock<T>(
  repo: Repo,
  fn: () => Promise<T>
): Promise<T> {
  const key = reflectionMaintenanceKey(repo)
  const task = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(fn)
  queues.set(key, task)
  void task
    .finally(() => {
      if (queues.get(key) === task) queues.delete(key)
    })
    .catch(() => {})
  return task
}
