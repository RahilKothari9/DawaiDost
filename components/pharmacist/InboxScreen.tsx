"use client";
import { Fragment } from "react";
import { ArrowRight, CheckCheck, MessageCircle, MessageSquare } from "lucide-react";
import type { InboxMessage } from "@/lib/pharmacist/derive";
import { clockHi, dayHi } from "@/lib/pharmacist/hindi";
import type { Screen } from "./PhoneApp";
import s from "./phone.module.css";

const TASK_LABEL = {
  dispatch: { hi: "पैक करें", en: "Pack it" },
  receive: { hi: "प्राप्ति दर्ज करें", en: "Confirm receipt" },
  recount: { hi: "दोबारा गिनें", en: "Recount" },
} as const;

/** SMS / WhatsApp receipts the system sends this pharmacist, newest first. */
export function InboxScreen({ messages, go }: { messages: InboxMessage[]; go: (s: Screen) => void }) {
  return (
    <div className={s.thread}>
      <div className={s.sender}>
        <span className={s.senderAvatar} aria-hidden>DD</span>
        <div>
          <strong>दवाई दोस्त · VM-DWDOST</strong>
          <small>जिला स्वास्थ्य कार्यालय, सीहोर · District health office</small>
        </div>
      </div>
      {messages.length === 0 ? <div className={`${s.card} ${s.empty}`}>कोई संदेश नहीं · No messages yet</div> : null}
      {messages.map((msg, i) => {
        const day = dayHi(msg.at);
        const divider = i === 0 || day !== dayHi(messages[i - 1].at);
        const task = msg.task;
        return (
          <Fragment key={msg.id}>
            {divider ? <div className={s.dayDivider}>{day}</div> : null}
            <article className={s.bubble} data-tone={msg.tone}>
              <p className={s.bubbleHi} lang="hi">{msg.hi}</p>
              <p className={s.bubbleEn} lang="en">{msg.en}</p>
              {task ? (
                <button
                  type="button"
                  className={`${s.btn} ${s.primary} ${s.block}`}
                  onClick={() => go(task.kind === "recount"
                    ? { name: "count", medicineId: task.id, recount: true }
                    : { name: task.kind, transferId: task.id })}
                >
                  <span className={s.btnStack}>{TASK_LABEL[task.kind].hi}<small>{TASK_LABEL[task.kind].en}</small></span>
                  <ArrowRight aria-hidden />
                </button>
              ) : null}
              <div className={s.bubbleMeta}>
                <span>{msg.channel === "whatsapp" ? <MessageCircle aria-hidden /> : <MessageSquare aria-hidden />}{msg.channel === "whatsapp" ? "WhatsApp" : "SMS"}</span>
                <span>{clockHi(msg.at)} <CheckCheck aria-hidden /></span>
              </div>
            </article>
          </Fragment>
        );
      })}
    </div>
  );
}
