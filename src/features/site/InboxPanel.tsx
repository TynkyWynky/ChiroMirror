import type { ContactMessage } from "../../types/content";

export default function InboxPanel(props: { messages: ContactMessage[]; onDelete: (id: string) => void }) {
  return (
    <section class="admin-panel">
      <div class="admin-panel-head">
        <div>
          <h2>Contactberichten</h2>
          <p>Nieuwe berichten die via het contactformulier zijn verstuurd.</p>
        </div>
      </div>

      <div class="admin-messages">
        {props.messages.length ? (
          props.messages.map((message) => (
            <article class="admin-message-card" key={message.id}>
              <div class="admin-message-head">
                <div>
                  <h3>{message.subject}</h3>
                  <p class="muted-small">
                    {message.name} | {message.email} | {message.category}
                  </p>
                </div>
                <button class="admin-remove" type="button" onClick={() => props.onDelete(message.id ?? "")}>
                  Verwijderen
                </button>
              </div>
              <p>{message.message}</p>
              <p class="muted-small">{message.createdAt ? new Date(message.createdAt).toLocaleString("nl-BE") : ""}</p>
            </article>
          ))
        ) : (
          <div class="card empty-state">
            <p>Nog geen contactberichten.</p>
          </div>
        )}
      </div>
    </section>
  );
}
