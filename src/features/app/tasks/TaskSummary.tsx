import { useEffect, useState } from "preact/hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppAccess } from "../types";
import { loadTasks, taskError } from "./data";
import { personalAssignment } from "./access";
import { formatDeadline, isOverdue, sortTasks } from "./dates";
import type { Task } from "./types";

export default function TaskSummary({ client, access, userId, onOpen }: { client: SupabaseClient; access: AppAccess; userId: string; onOpen: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setError("");
    loadTasks(client, access, true).then(data => {
      if (active) setTasks(sortTasks(data.tasks.filter(task => task.status !== "DONE" && task.status !== "CANCELLED" &&
        (task.scope === "PERSONAL" ? task.owner_member_id === access.member?.id && task.owner_user_id === userId : Boolean(personalAssignment(task, data.assignments, access))))).slice(0, 5));
    }).catch(cause => { if (active) setError(taskError(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, access, userId, attempt]);
  return <section class="admin-subpanel" lang="fr"><h2>Mes prochaines tâches</h2>
    {loading ? <p role="status">Chargement…</p> : error ? <p role="alert">{error} <button type="button" onClick={() => setAttempt(value => value + 1)}>Réessayer</button></p> : tasks.length ? <ul>{tasks.map(task => <li key={task.id}><strong>{task.title}</strong> — {formatDeadline(task)}{isOverdue(task) ? " · En retard" : ""}</li>)}</ul> : <p>Aucune tâche active pour vous.</p>}
    <button class="btn btn-light" type="button" onClick={onOpen}>Voir mes tâches</button>
  </section>;
}
