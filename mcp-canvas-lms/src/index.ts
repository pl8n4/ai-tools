#!/usr/bin/env node

/**
 * Canvas MCP Server
 *
 * Exposes Canvas LMS data to Claude via the Model Context Protocol.
 * Tools: get_courses, get_assignments, get_upcoming_deadlines, get_grades,
 *        get_course_modules, get_announcements, get_submission_status,
 *        get_syllabus, get_todo_items
 * Resources: canvas://dashboard
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CanvasApiClient } from "./canvas-api.js";

// ─── Configuration ──────────────────────────────────────────────────

const CANVAS_API_TOKEN = process.env.CANVAS_API_TOKEN;
const CANVAS_BASE_URL = process.env.CANVAS_BASE_URL;

if (!CANVAS_API_TOKEN) {
    console.error("Error: CANVAS_API_TOKEN environment variable is required.");
    console.error(
        "Generate one at: Canvas → Account → Settings → Approved Integrations"
    );
    process.exit(1);
}

if (!CANVAS_BASE_URL) {
    console.error("Error: CANVAS_BASE_URL environment variable is required.");
    console.error("Example: https://yourschool.instructure.com");
    process.exit(1);
}

const canvas = new CanvasApiClient({
    baseUrl: CANVAS_BASE_URL,
    token: CANVAS_API_TOKEN,
});

// ─── Server Setup ───────────────────────────────────────────────────

const server = new McpServer({
    name: "canvas-mcp",
    version: "1.0.0",
});

// ─── Helper: strip HTML tags for cleaner LLM output ─────────────────

function stripHtml(html: string | null | undefined): string {
    if (!html) return "";
    return html
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

// ─── Helper: format date for human-readable output ──────────────────

function formatDate(dateStr: string | null): string {
    if (!dateStr) return "No date set";
    const d = new Date(dateStr);
    return d.toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
    });
}

// ─── Tools ──────────────────────────────────────────────────────────

// 1. get_courses
server.tool(
    "get_courses",
    "List all active Canvas courses with enrollment info and current grades",
    {},
    async () => {
        try {
            const courses = await canvas.getCourses();
            const courseList = courses.map((c) => {
                const enrollment = c.enrollments?.find(
                    (e) => e.type === "student" || e.type === "StudentEnrollment"
                );
                return {
                    id: c.id,
                    name: c.name,
                    code: c.course_code,
                    current_score: enrollment?.computed_current_score ?? "N/A",
                    current_grade: enrollment?.computed_current_grade ?? "N/A",
                };
            });
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(courseList, null, 2),
                    },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `Error fetching courses: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    }
);

// 2. get_assignments
server.tool(
    "get_assignments",
    "Get assignments for a specific course. Optionally filter by status: upcoming, past, overdue, unsubmitted",
    {
        course_id: z.number().describe("Canvas course ID"),
        filter: z
            .enum(["upcoming", "past", "overdue", "unsubmitted", "ungraded", "all"])
            .optional()
            .default("all")
            .describe("Filter assignments by status"),
    },
    async ({ course_id, filter }) => {
        try {
            const bucket = filter === "all" ? undefined : filter;
            const assignments = await canvas.getAssignments(course_id, bucket);
            const formatted = assignments.map((a) => ({
                id: a.id,
                name: a.name,
                due_at: formatDate(a.due_at),
                points_possible: a.points_possible,
                submission_types: a.submission_types,
                published: a.published,
                url: a.html_url,
            }));
            return {
                content: [
                    {
                        type: "text" as const,
                        text:
                            formatted.length > 0
                                ? JSON.stringify(formatted, null, 2)
                                : "No assignments found matching the filter.",
                    },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `Error fetching assignments: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    }
);

// 3. get_upcoming_deadlines
server.tool(
    "get_upcoming_deadlines",
    "Get ALL assignments due in the next N days across ALL courses, sorted by due date. Use days_ahead=7 for this week, days_ahead=30 for this month, or days_ahead=90 for the semester. Default is 30 days. Always use a generous window to avoid missing assignments.",
    {
        days_ahead: z
            .number()
            .optional()
            .default(30)
            .describe("Number of days to look ahead (default: 30). Use 7 for this week, 30 for this month, 90+ for the semester."),
    },
    async ({ days_ahead }) => {
        try {
            const upcoming = await canvas.getUpcomingAssignments(days_ahead);
            const formatted = upcoming.map((a) => ({
                course: a.course_name,
                assignment: a.name,
                due_at: formatDate(a.due_at),
                points: a.points_possible,
                url: a.html_url,
            }));
            return {
                content: [
                    {
                        type: "text" as const,
                        text:
                            formatted.length > 0
                                ? `📅 Upcoming deadlines (next ${days_ahead} days):\n\n${JSON.stringify(formatted, null, 2)}`
                                : `No assignments due in the next ${days_ahead} days. 🎉`,
                    },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `Error fetching upcoming deadlines: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    }
);

// 4. get_grades
server.tool(
    "get_grades",
    "Get current grades and scores for all active courses",
    {},
    async () => {
        try {
            const grades = await canvas.getGrades();
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(grades, null, 2),
                    },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `Error fetching grades: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    }
);

// 5. get_course_modules
server.tool(
    "get_course_modules",
    "Get the module structure for a course (topics, learning materials, completion status)",
    {
        course_id: z.number().describe("Canvas course ID"),
    },
    async ({ course_id }) => {
        try {
            const modules = await canvas.getModules(course_id);
            const formatted = modules.map((m) => ({
                name: m.name,
                state: m.state,
                items:
                    m.items?.map((item) => ({
                        title: item.title,
                        type: item.type,
                        completed: item.completion_requirement?.completed ?? null,
                        url: item.html_url,
                    })) ?? [],
            }));
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(formatted, null, 2),
                    },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `Error fetching modules: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    }
);

// 6. get_announcements
server.tool(
    "get_announcements",
    "Get recent announcements from your courses. Shows instructor messages and updates.",
    {
        course_id: z
            .number()
            .optional()
            .describe(
                "Optional: specific course ID. If omitted, gets announcements from all courses."
            ),
        days_back: z
            .number()
            .optional()
            .default(14)
            .describe("Number of days to look back (default: 14)"),
    },
    async ({ course_id, days_back }) => {
        try {
            let courseIds: number[];
            if (course_id) {
                courseIds = [course_id];
            } else {
                const courses = await canvas.getCourses();
                courseIds = courses.map((c) => c.id);
            }

            if (courseIds.length === 0) {
                return {
                    content: [
                        { type: "text" as const, text: "No active courses found." },
                    ],
                };
            }

            const announcements = await canvas.getAnnouncements(
                courseIds,
                days_back
            );
            const formatted = announcements.map((a) => ({
                title: a.title,
                posted: formatDate(a.posted_at),
                author: a.author.display_name,
                message: stripHtml(a.message).slice(0, 500),
                url: a.html_url,
            }));
            return {
                content: [
                    {
                        type: "text" as const,
                        text:
                            formatted.length > 0
                                ? JSON.stringify(formatted, null, 2)
                                : `No announcements in the last ${days_back} days.`,
                    },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `Error fetching announcements: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    }
);

// 7. get_submission_status
server.tool(
    "get_submission_status",
    "Check the submission status and grade for a specific assignment",
    {
        course_id: z.number().describe("Canvas course ID"),
        assignment_id: z.number().describe("Canvas assignment ID"),
    },
    async ({ course_id, assignment_id }) => {
        try {
            const sub = await canvas.getSubmission(course_id, assignment_id);
            const result = {
                submitted: sub.workflow_state !== "unsubmitted",
                status: sub.workflow_state,
                submitted_at: formatDate(sub.submitted_at),
                score: sub.score,
                grade: sub.grade,
                late: sub.late,
                missing: sub.missing,
                excused: sub.excused,
                attempt: sub.attempt,
            };
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `Error fetching submission: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    }
);

// 8. get_syllabus
server.tool(
    "get_syllabus",
    "Get the syllabus content for a course",
    {
        course_id: z.number().describe("Canvas course ID"),
    },
    async ({ course_id }) => {
        try {
            const syllabus = await canvas.getSyllabus(course_id);
            return {
                content: [
                    {
                        type: "text" as const,
                        text: syllabus
                            ? stripHtml(syllabus)
                            : "No syllabus content available for this course.",
                    },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `Error fetching syllabus: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    }
);

// 9. get_todo_items
server.tool(
    "get_todo_items",
    "Get your Canvas to-do list — items Canvas thinks you need to act on",
    {},
    async () => {
        try {
            const todos = await canvas.getTodoItems();
            const formatted = todos.map((t) => ({
                type: t.type,
                course: t.context_name,
                assignment: t.assignment?.name ?? "N/A",
                due_at: formatDate(t.assignment?.due_at ?? null),
                url: t.html_url,
            }));
            return {
                content: [
                    {
                        type: "text" as const,
                        text:
                            formatted.length > 0
                                ? JSON.stringify(formatted, null, 2)
                                : "Your to-do list is clear! 🎉",
                    },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `Error fetching to-do items: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    }
);

// ─── Resources ──────────────────────────────────────────────────────

server.resource(
    "dashboard",
    "canvas://dashboard",
    {
        description:
            "Overview dashboard: your active courses, upcoming deadlines, current grades, and to-do items",
        mimeType: "application/json",
    },
    async (uri) => {
        try {
            const [courses, grades, upcoming, todos] = await Promise.all([
                canvas.getCourses(),
                canvas.getGrades(),
                canvas.getUpcomingAssignments(30),
                canvas.getTodoItems(),
            ]);

            const dashboard = {
                generated_at: new Date().toISOString(),
                active_courses: courses.map((c) => ({
                    id: c.id,
                    name: c.name,
                    code: c.course_code,
                })),
                grades,
                upcoming_deadlines: upcoming.map((a) => ({
                    course: a.course_name,
                    assignment: a.name,
                    due_at: formatDate(a.due_at),
                    points: a.points_possible,
                })),
                todo_items: todos.map((t) => ({
                    course: t.context_name,
                    assignment: t.assignment?.name ?? "N/A",
                    due_at: formatDate(t.assignment?.due_at ?? null),
                })),
            };

            return {
                contents: [
                    {
                        uri: uri.href,
                        mimeType: "application/json",
                        text: JSON.stringify(dashboard, null, 2),
                    },
                ],
            };
        } catch (error) {
            return {
                contents: [
                    {
                        uri: uri.href,
                        mimeType: "text/plain",
                        text: `Error building dashboard: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
            };
        }
    }
);

// ─── Start Server ───────────────────────────────────────────────────

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Canvas MCP server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
