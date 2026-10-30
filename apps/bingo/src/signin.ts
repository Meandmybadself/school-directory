// The sign-in sheet: email in, magic link out, the same /auth/start flow every
// sibling app uses (returnTo = this origin, allowed because this origin is in
// ALLOWED_ORIGINS). Plain DOM rather than a component — it is one form. All
// copy from the shared dictionaries (invariant 6); styles in index.html.

import { api } from "./lib/api.js";
import { t } from "./lib/i18n.js";

export interface SigninSheet {
  open: () => void;
}

export function createSigninSheet(): SigninSheet {
  const overlay = document.createElement("div");
  overlay.className = "signin-overlay";
  overlay.hidden = true;

  const card = document.createElement("div");
  card.className = "signin-card";
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const close = () => {
    overlay.hidden = true;
  };
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  function renderForm() {
    card.textContent = "";
    const title = document.createElement("h2");
    title.textContent = t("bingoSignInTitle");
    const lead = document.createElement("p");
    lead.textContent = t("signInLead");
    const form = document.createElement("form");
    const label = document.createElement("label");
    label.htmlFor = "signin-email";
    label.textContent = t("emailLabel");
    const input = document.createElement("input");
    input.type = "email";
    input.id = "signin-email";
    input.required = true;
    input.autocomplete = "email";
    const actions = document.createElement("div");
    actions.className = "signin-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "cancel";
    cancel.textContent = t("cancel");
    cancel.addEventListener("click", close);
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = t("emailLink");
    actions.append(cancel, submit);
    form.append(label, input, actions);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = input.value.trim();
      if (!email) return;
      submit.disabled = true;
      // The response never varies by account existence (invariant 4), so there
      // is nothing to branch on: sent is sent.
      void api
        .authStart(email)
        .then(() => renderSent(email))
        .finally(() => {
          submit.disabled = false;
        });
    });
    card.append(title, lead, form);
    input.focus();
  }

  function renderSent(email: string) {
    card.textContent = "";
    const title = document.createElement("h2");
    title.textContent = t("checkEmailTitle");
    const lead = document.createElement("p");
    lead.textContent = t("checkEmailLead", { email });
    const actions = document.createElement("div");
    actions.className = "signin-actions";
    const resend = document.createElement("button");
    resend.type = "button";
    resend.className = "cancel";
    resend.textContent = t("resendLink");
    resend.addEventListener("click", renderForm);
    const done = document.createElement("button");
    done.type = "submit";
    done.textContent = t("done");
    done.addEventListener("click", close);
    actions.append(resend, done);
    card.append(title, lead, actions);
  }

  return {
    open: () => {
      renderForm();
      overlay.hidden = false;
    },
  };
}
