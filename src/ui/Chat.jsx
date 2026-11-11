import { useEffect, useRef, useState } from 'preact/hooks';

export function Chat({ room, info }) {
  const [text, setText] = useState('');
  const list = useRef(null);
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [info.chat.length, info.chat.at(-1)?.id]);

  const send = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    room.command('chat', { text });
    setText('');
  };

  return (
    <div class="panel chat">
      <h3>Chat</h3>
      <div class="chat-log" ref={list}>
        {info.chat.map((c) =>
          c.sys ? (
            <div key={c.id} class="chat-sys">
              {c.text}
            </div>
          ) : (
            <div key={c.id} class="chat-msg">
              <b>{c.name}</b> {c.text}
            </div>
          )
        )}
      </div>
      <form class="chat-form" onSubmit={send}>
        <input name="chat" value={text} maxLength={300} aria-label="Message" placeholder="Say something" onInput={(e) => setText(e.currentTarget.value)} />
        <button class="btn btn-outline">Send</button>
      </form>
    </div>
  );
}
