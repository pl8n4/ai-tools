/**
 * Canvas LMS API Client
 * Thin wrapper around the Canvas REST API with auto-pagination support.
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface CanvasConfig {
    baseUrl: string;
    token: string;
}

export interface Course {
    id: number;
    name: string;
    course_code: string;
    enrollment_term_id: number;
    workflow_state: string;
    enrollments?: Enrollment[];
    total_scores?: boolean;
    syllabus_body?: string;
}

export interface Enrollment {
    type: string;
    role: string;
    enrollment_state: string;
    computed_current_score?: number | null;
    computed_final_score?: number | null;
    computed_current_grade?: string | null;
    computed_final_grade?: string | null;
}

export interface Assignment {
    id: number;
    name: string;
    description: string | null;
    due_at: string | null;
    lock_at: string | null;
    unlock_at: string | null;
    points_possible: number | null;
    course_id: number;
    submission_types: string[];
    has_submitted_submissions: boolean;
    html_url: string;
    published: boolean;
}

export interface Submission {
    id: number;
    assignment_id: number;
    user_id: number;
    submitted_at: string | null;
    score: number | null;
    grade: string | null;
    workflow_state: string;
    late: boolean;
    missing: boolean;
    excused: boolean | null;
    attempt: number | null;
}

export interface Module {
    id: number;
    name: string;
    position: number;
    unlock_at: string | null;
    state: string;
    items_count: number;
    items?: ModuleItem[];
}

export interface ModuleItem {
    id: number;
    title: string;
    position: number;
    type: string;
    module_id: number;
    html_url: string;
    content_id?: number;
    completion_requirement?: {
        type: string;
        completed: boolean;
    };
}

export interface Announcement {
    id: number;
    title: string;
    message: string;
    posted_at: string;
    context_code: string;
    html_url: string;
    author: {
        display_name: string;
    };
}

export interface TodoItem {
    type: string;
    assignment?: Assignment;
    context_name: string;
    html_url: string;
}

// ─── Client ─────────────────────────────────────────────────────────

export class CanvasApiClient {
    private baseUrl: string;
    private token: string;

    constructor(config: CanvasConfig) {
        // Strip trailing slash from base URL
        this.baseUrl = config.baseUrl.replace(/\/+$/, "");
        this.token = config.token;
    }

    // ── Internal fetch with auth + auto-pagination ──

    private async fetchApi<T>(
        path: string,
        params: Record<string, string> = {},
        paginate: boolean = true
    ): Promise<T[]> {
        const url = new URL(`${this.baseUrl}/api/v1${path}`);
        url.searchParams.set("per_page", "100");

        for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, value);
        }

        const results: T[] = [];
        let nextUrl: string | null = url.toString();

        while (nextUrl) {
            const response = await fetch(nextUrl, {
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    "Content-Type": "application/json",
                },
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(
                    `Canvas API error ${response.status}: ${response.statusText} — ${errorText}`
                );
            }

            const data = await response.json();

            if (Array.isArray(data)) {
                results.push(...data);
            } else {
                // Single object response — wrap and return immediately
                return [data as T];
            }

            if (!paginate) break;

            // Parse Link header for pagination
            const linkHeader = response.headers.get("Link");
            nextUrl = this.parseNextLink(linkHeader);
        }

        return results;
    }

    private parseNextLink(linkHeader: string | null): string | null {
        if (!linkHeader) return null;
        const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        return match ? match[1] : null;
    }

    // ── Public methods ──

    /**
     * Get all active courses for the authenticated user.
     * Includes enrollment info with scores/grades.
     */
    async getCourses(): Promise<Course[]> {
        const courses = await this.fetchApi<Course>("/courses", {
            "enrollment_state": "active",
            "include[]": "total_scores",
            "state[]": "available",
        });
        return courses;
    }

    /**
     * Get a single course by ID, optionally including syllabus.
     */
    async getCourse(
        courseId: number,
        includeSyllabus: boolean = false
    ): Promise<Course> {
        const params: Record<string, string> = {};
        if (includeSyllabus) {
            params["include[]"] = "syllabus_body";
        }
        const results = await this.fetchApi<Course>(
            `/courses/${courseId}`,
            params,
            false
        );
        return results[0];
    }

    /**
     * Get assignments for a specific course.
     * Optionally filter by bucket: past, overdue, undated, ungraded, unsubmitted, upcoming, future.
     */
    async getAssignments(
        courseId: number,
        bucket?: string,
        orderBy: string = "due_at"
    ): Promise<Assignment[]> {
        const params: Record<string, string> = {
            order_by: orderBy,
        };
        if (bucket) {
            params["bucket"] = bucket;
        }
        return this.fetchApi<Assignment>(
            `/courses/${courseId}/assignments`,
            params
        );
    }

    /**
     * Get upcoming assignments across ALL active courses for the next N days.
     */
    async getUpcomingAssignments(daysAhead: number = 7): Promise<
        (Assignment & { course_name: string })[]
    > {
        const courses = await this.getCourses();
        const now = new Date();
        const cutoff = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

        const upcoming: (Assignment & { course_name: string })[] = [];

        for (const course of courses) {
            try {
                // Fetch ALL assignments — Canvas's "upcoming" bucket is unreliable
                // and silently drops assignments. We filter by date ourselves.
                const assignments = await this.getAssignments(course.id);
                for (const a of assignments) {
                    if (a.due_at) {
                        const dueDate = new Date(a.due_at);
                        if (dueDate >= now && dueDate <= cutoff) {
                            upcoming.push({ ...a, course_name: course.name });
                        }
                    }
                }
            } catch {
                // Skip courses where assignments can't be fetched (e.g., observer roles)
                continue;
            }
        }

        // Sort by due date
        upcoming.sort((a, b) => {
            const dateA = new Date(a.due_at!).getTime();
            const dateB = new Date(b.due_at!).getTime();
            return dateA - dateB;
        });

        return upcoming;
    }

    /**
     * Get grades for all active courses.
     */
    async getGrades(): Promise<
        {
            course_id: number;
            course_name: string;
            current_score: number | null;
            current_grade: string | null;
            final_score: number | null;
            final_grade: string | null;
        }[]
    > {
        const courses = await this.getCourses();
        const grades: {
            course_id: number;
            course_name: string;
            current_score: number | null;
            current_grade: string | null;
            final_score: number | null;
            final_grade: string | null;
        }[] = [];

        for (const course of courses) {
            const enrollment = course.enrollments?.find(
                (e) => e.type === "student" || e.type === "StudentEnrollment"
            );
            grades.push({
                course_id: course.id,
                course_name: course.name,
                current_score: enrollment?.computed_current_score ?? null,
                current_grade: enrollment?.computed_current_grade ?? null,
                final_score: enrollment?.computed_final_score ?? null,
                final_grade: enrollment?.computed_final_grade ?? null,
            });
        }

        return grades;
    }

    /**
     * Get modules for a course, including items inline.
     */
    async getModules(courseId: number): Promise<Module[]> {
        return this.fetchApi<Module>(`/courses/${courseId}/modules`, {
            "include[]": "items",
        });
    }

    /**
     * Get recent announcements for given course IDs.
     */
    async getAnnouncements(
        courseIds: number[],
        daysBack: number = 14
    ): Promise<Announcement[]> {
        const startDate = new Date(
            Date.now() - daysBack * 24 * 60 * 60 * 1000
        ).toISOString();

        const contextCodes = courseIds
            .map((id) => `course_${id}`)
            .join("&context_codes[]=");

        // Build URL manually for array param
        const url = new URL(`${this.baseUrl}/api/v1/announcements`);
        for (const id of courseIds) {
            url.searchParams.append("context_codes[]", `course_${id}`);
        }
        url.searchParams.set("start_date", startDate);
        url.searchParams.set("per_page", "50");

        const response = await fetch(url.toString(), {
            headers: {
                Authorization: `Bearer ${this.token}`,
                "Content-Type": "application/json",
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                `Canvas API error ${response.status}: ${response.statusText} — ${errorText}`
            );
        }

        return response.json() as Promise<Announcement[]>;
    }

    /**
     * Get your own submission for a specific assignment.
     */
    async getSubmission(
        courseId: number,
        assignmentId: number
    ): Promise<Submission> {
        const results = await this.fetchApi<Submission>(
            `/courses/${courseId}/assignments/${assignmentId}/submissions/self`,
            {},
            false
        );
        return results[0];
    }

    /**
     * Get the syllabus for a course.
     */
    async getSyllabus(courseId: number): Promise<string | null> {
        const course = await this.getCourse(courseId, true);
        return course.syllabus_body ?? null;
    }

    /**
     * Get the authenticated user's Canvas to-do items.
     */
    async getTodoItems(): Promise<TodoItem[]> {
        return this.fetchApi<TodoItem>("/users/self/todo");
    }
}
