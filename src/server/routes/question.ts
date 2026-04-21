import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Question } from "@/question"
import { QuestionID } from "@/question/schema"
import { errors } from "@/server/error"
import { lazy } from "@/util/lazy"

export const QuestionRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List pending questions",
        operationId: "question.list",
        responses: {
          200: {
            description: "List of pending questions",
            content: { "application/json": { schema: resolver(Question.Request.array()) } },
          },
        },
      }),
      async (c) => c.json(await Question.list()),
    )
    .post(
      "/:requestID/reply",
      describeRoute({
        summary: "Reply to question",
        operationId: "question.reply",
        responses: {
          200: { description: "Answered", content: { "application/json": { schema: resolver(z.boolean()) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ requestID: QuestionID.zod })),
      validator("json", Question.Reply),
      async (c) => {
        await Question.reply({ requestID: c.req.valid("param").requestID, answers: c.req.valid("json").answers })
        return c.json(true)
      },
    )
    .post(
      "/:requestID/reject",
      describeRoute({
        summary: "Reject question",
        operationId: "question.reject",
        responses: {
          200: { description: "Rejected", content: { "application/json": { schema: resolver(z.boolean()) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ requestID: QuestionID.zod })),
      async (c) => {
        await Question.reject(c.req.valid("param").requestID)
        return c.json(true)
      },
    ),
)
