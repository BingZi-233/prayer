import { afterEach, describe, expect, it } from "vitest"
import { openDb } from "@/lib/core/db"
import { Repo } from "@/lib/core/db/repo"

let db: ReturnType<typeof openDb> | undefined
afterEach(() => { db?.close(); db = undefined })

describe("批量主题样例", () => {
  it("按主题分组、时间降序去重并限制每组数量", () => {
    db = openDb(":memory:")
    const repo = new Repo(db)
    const a = repo.insertQuestionTopic("A", 1)
    const b = repo.insertQuestionTopic("B", 1)
    repo.insertQuestionOccurrence(a, "qq", "1", "u", "重复", 100)
    repo.insertQuestionOccurrence(a, "qq", "1", "u", "重复", 300)
    repo.insertQuestionOccurrence(a, "qq", "1", "u", "较旧", 200)
    repo.insertQuestionOccurrence(b, "qq", "1", "u", "B样例", 250)
    repo.insertQuestionOccurrence(b, "qq", "1", "u", "B旧", 150)
    expect(repo.topicSamplesBatch([a, b], 2, 0)).toEqual(new Map([
      [a, ["重复", "较旧"]],
      [b, ["B样例", "B旧"]],
    ]))
    expect(repo.topicSamplesBatch([], 2)).toEqual(new Map())
    expect(repo.topicSamplesBatch([a, b], 0)).toEqual(new Map([[a, []], [b, []]]))
    expect(repo.topicSamplesBatch([a, b], 2, 220)).toEqual(new Map([[a, ["重复"]], [b, ["B样例"]]]))
  })
})
