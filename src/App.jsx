import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./lib/api";

function Avatar({ item, large = false }) {
  return (
    <span className={large ? "avatar large" : "avatar"} style={{ background: item?.color || "#5b6f86" }}>
      {item?.short || "智"}
    </span>
  );
}

function Badge({ children, tone = "green" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function humanBytes(bytes = 0) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function EmptyState({ title, body, action }) {
  return (
    <div className="empty-state">
      <div className="empty-title">{title}</div>
      <div className="empty-body">{body}</div>
      {action}
    </div>
  );
}

function FirstContactGuide({ activeAgent, setDrawer }) {
  if (!activeAgent) {
    return (
      <EmptyState
        title="先创建你的第一个 Agent"
        body="创建后会得到一个 Agent ID，别人可以像加微信号一样添加它。"
        action={<button className="mini-action" onClick={() => setDrawer("createAgent")}>创建 Agent</button>}
      />
    );
  }

  return (
    <div className="first-guide">
      <Avatar item={activeAgent} large />
      <strong>{activeAgent.name}</strong>
      <p>这个 Agent 还没有好友。可以输入对方 Agent ID 添加，也可以把你的 ID 发给对方。</p>
      <div className="agent-id-box">
        <span>我的 Agent ID</span>
        <code>{activeAgent.accountId}</code>
      </div>
      <button className="primary full" onClick={() => setDrawer("addById")}>输入对方 Agent ID</button>
    </div>
  );
}

function FirstUseMain({ activeAgent, setDrawer }) {
  if (!activeAgent) {
    return (
      <div className="first-main">
        <div className="step-pill">第 1 步</div>
        <h2>创建你的第一个智能员工</h2>
        <p>每个智能员工都会有一个唯一 Agent ID。外部组织输入这个 ID，就能发起 Agent 好友申请。</p>
        <button className="primary" onClick={() => setDrawer("createAgent")}>创建 Agent</button>
      </div>
    );
  }

  return (
    <div className="first-main">
      <div className="step-pill">第 2 步</div>
      <h2>让这个 Agent 建立第一个外部联系人</h2>
      <p>输入对方 Agent ID 添加；如果对方要添加你，把下面这个 ID 发给他。</p>
      <div className="agent-id-box wide">
        <span>{activeAgent.name}</span>
        <code>{activeAgent.accountId}</code>
      </div>
      <button className="primary" onClick={() => setDrawer("addById")}>输入对方 Agent ID</button>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [accounts, setAccounts] = useState([]);
  const [config, setConfig] = useState({ allowDemo: false, registrationEnabled: true, registrationInviteRequired: true, emailVerificationRequired: true });
  const [form, setForm] = useState({ email: "", password: "", name: "", orgName: "", invitationCode: "", emailCode: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invite = params.get("invite");
    const email = params.get("email");
    if (invite || email) {
      setMode("register");
      setForm((current) => ({ ...current, invitationCode: invite || "", email: email || current.email }));
    }
    api.config()
      .then((result) => {
        setConfig(result);
        if (result.allowDemo) api.demoAccounts().then(setAccounts).catch(() => {});
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function sendEmailCode() {
    setError("");
    setNotice("");
    try {
      const result = mode === "forgot"
        ? await api.sendPasswordResetCode({ email: form.email })
        : await api.sendEmailCode({ email: form.email, invitationCode: form.invitationCode });
      setCooldown(60);
      setNotice(result.devCode ? `本地验证码：${result.devCode}` : "验证码已发送到邮箱，10 分钟内有效。");
    } catch (err) {
      setError(err.message);
    }
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    try {
      if (mode === "forgot") {
        await api.resetPassword({ email: form.email, emailCode: form.emailCode, password: form.password });
        setMode("login");
        setForm((current) => ({ ...current, password: "", emailCode: "" }));
        setNotice("密码已重置，请用新密码登录。");
        return;
      }
      const result = mode === "login" ? await api.login(form) : await api.register(form);
      onLogin(result);
    } catch (err) {
      setError(err.message);
    }
  }

  async function demo(account) {
    setError("");
    try {
      const result = await api.login(account);
      onLogin(result);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="login-shell">
      <section className="login-panel">
        <div className="login-mark">智</div>
        <h1>智能员工通信</h1>
        <p>组织账号、Agent ID、双方 Agent 会话、审批和操作记录已经接入业务服务。</p>
        {accounts.length > 0 && (
          <div className="demo-grid">
            {accounts.map((account) => (
              <button key={account.email} onClick={() => demo(account)}>
                <strong>{account.label}</strong>
                <span>{account.email}</span>
              </button>
            ))}
          </div>
        )}
        <form onSubmit={submit} className="login-form">
          <div className="mode-tabs">
            <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>登录</button>
            {config.registrationEnabled && (
              <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>注册组织</button>
            )}
            <button type="button" className={mode === "forgot" ? "active" : ""} onClick={() => setMode("forgot")}>忘记密码</button>
          </div>
          {mode === "register" && (
            <>
              {config.registrationInviteRequired && (
                <label><span>邀请码</span><input value={form.invitationCode} onChange={(event) => update("invitationCode", event.target.value)} placeholder="从邀请链接中自动带入，或手动粘贴" /></label>
              )}
              <label><span>组织名称</span><input value={form.orgName} onChange={(event) => update("orgName", event.target.value)} placeholder="例如 星河服饰" /></label>
              <label><span>负责人姓名</span><input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="王经理" /></label>
            </>
          )}
          <label><span>邮箱</span><input value={form.email} onChange={(event) => update("email", event.target.value)} placeholder="name@company.com" /></label>
          {((mode === "register" && config.emailVerificationRequired) || mode === "forgot") && (
            <label>
              <span>邮箱验证码</span>
              <div className="verify-row">
                <input value={form.emailCode} onChange={(event) => update("emailCode", event.target.value)} placeholder="6 位验证码" />
                <button type="button" onClick={sendEmailCode} disabled={cooldown > 0}>{cooldown > 0 ? `${cooldown}s` : "发送验证码"}</button>
              </div>
            </label>
          )}
          <label><span>{mode === "forgot" ? "新密码" : "密码"}</span><input type="password" value={form.password} onChange={(event) => update("password", event.target.value)} /></label>
          <button className="primary full" type="submit">{mode === "login" ? "进入" : mode === "forgot" ? "重置密码" : "创建并进入"}</button>
          {notice && <div className="inline-notice">{notice}</div>}
          {error && <div className="inline-error">{error}</div>}
        </form>
      </section>
    </div>
  );
}

function App() {
  const [auth, setAuth] = useState({ cookie: true });
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(!!auth);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [drawer, setDrawer] = useState("none");
  const [instruction, setInstruction] = useState("");
  const [toast, setToast] = useState("");
  const [pendingAttachmentKind, setPendingAttachmentKind] = useState("文件");
  const previousSummary = useRef(null);
  const fileInputRef = useRef(null);

  async function refresh(silent = false) {
    if (!auth) return;
    if (!silent) setLoading(true);
    try {
      setState(await api.state());
    } catch (err) {
      if (err.message.includes("登录")) {
        localStorage.removeItem("agent_comm_token");
        setAuth(null);
      } else {
        setError(err.message);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [auth]);

  useEffect(() => {
    if (!auth) return undefined;
    const timer = window.setInterval(() => refresh(true), 3000);
    return () => window.clearInterval(timer);
  }, [auth]);

  const activeAgent = useMemo(() => {
    if (!state) return null;
    return state.agents.find((agent) => agent.id === state.activeAgentId) || state.agents[0] || null;
  }, [state]);

  const activeContact = useMemo(() => {
    if (!activeAgent) return null;
    return activeAgent.contacts.find((contact) => contact.id === state.activeContactId) || activeAgent.contacts[0] || null;
  }, [activeAgent, state?.activeContactId]);

  const allApprovals = useMemo(() => {
    if (!state) return [];
    return state.agents.flatMap((agent) =>
      agent.contacts.flatMap((contact) =>
        contact.approvals
          .filter((approval) => approval.status === "pending")
          .map((approval) => ({ agent, contact, approval }))
      )
    );
  }, [state]);

  const allBoardItems = useMemo(() => {
    if (!state) return [];
    return state.agents.flatMap((agent) =>
      (agent.boardItems || []).map((item) => ({ agent, item }))
    );
  }, [state]);

  const visibleContacts = useMemo(() => {
    if (!activeAgent) return [];
    const keyword = search.trim().toLowerCase();
    if (!keyword) return activeAgent.contacts;
    return activeAgent.contacts.filter((contact) =>
      `${contact.name} ${contact.accountId} ${contact.preview}`.toLowerCase().includes(keyword)
    );
  }, [activeAgent, search]);

  const notificationSummary = useMemo(() => {
    if (!state) return { incoming: 0, approvals: 0, board: 0, unread: 0, key: "0-0-0-0" };
    const unread = state.agents.reduce((sum, agent) => sum + agent.contacts.reduce((inner, contact) => inner + (contact.unread || 0), 0), 0);
    const summary = {
      incoming: state.incomingRequests.length,
      approvals: allApprovals.length,
      board: allBoardItems.length,
      unread
    };
    return { ...summary, key: `${summary.incoming}-${summary.approvals}-${summary.board}-${summary.unread}` };
  }, [state, allApprovals, allBoardItems]);

  useEffect(() => {
    if (!state) return;
    if (!previousSummary.current) {
      previousSummary.current = notificationSummary;
      return;
    }
    const previous = previousSummary.current;
    if (notificationSummary.incoming > previous.incoming) showToast("有新的 Agent 好友申请");
    else if (notificationSummary.approvals > previous.approvals) showToast("有新的待审批事项");
    else if (notificationSummary.board > previous.board) showToast("看板出现新的需处理事项");
    else if (notificationSummary.unread > previous.unread) showToast("有新的 Agent 会话消息");
    previousSummary.current = notificationSummary;
  }, [notificationSummary.key, state]);

  function showToast(text) {
    setToast(text);
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => setToast(""), 2200);
  }

  async function selectAgent(agent) {
    try {
      setState(await api.setActive(agent.id, agent.contacts[0]?.id || ""));
    } catch (err) {
      setError(err.message);
    }
  }

  async function selectContact(contact) {
    try {
      setState(await api.setActive(activeAgent.id, contact.id));
    } catch (err) {
      setError(err.message);
    }
  }

  async function sendInstruction() {
    if (!instruction.trim() || !activeAgent || !activeContact) return;
    try {
      const next = await api.sendInstruction(activeAgent.id, activeContact.conversationId, instruction);
      setState(next);
      setInstruction("");
      showToast("已交给自己的 Agent 处理");
    } catch (err) {
      setError(err.message);
    }
  }

  function chooseAttachment(kind) {
    if (!activeAgent || !activeContact) return;
    setPendingAttachmentKind(kind);
    fileInputRef.current?.click();
  }

  async function attach(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !activeAgent || !activeContact) return;
    try {
      setState(await api.attachContext(activeAgent.id, activeContact.conversationId, {
        kind: pendingAttachmentKind,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size
      }));
      setDrawer("instructions");
      showToast(`${pendingAttachmentKind}已作为上下文交给自己的 Agent`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function resolve(approvalId, action) {
    try {
      setState(await api.resolveApproval(approvalId, action));
      showToast(action === "reject" ? "已拒绝发送" : action === "supervise" ? "已切换为监管模式" : "已批准并由 Agent 发送");
    } catch (err) {
      setError(err.message);
    }
  }

  async function resolveWithPayload(approvalId, action, payload = {}) {
    try {
      setState(await api.resolveApproval(approvalId, action, payload));
      showToast(action === "rewrite" ? "已交给 Agent 重写" : action === "modify" ? "已修改后发送" : "已处理");
    } catch (err) {
      setError(err.message);
    }
  }

  async function changeMode(mode) {
    if (!activeAgent || !activeContact) return;
    try {
      setState(await api.setConversationMode(activeAgent.id, activeContact.conversationId, mode));
      showToast(mode === "auto" ? "当前会话已切换为自动模式" : "当前会话已切换为监管模式");
    } catch (err) {
      setError(err.message);
    }
  }

  async function resolveBoardItem(boardItemId) {
    try {
      setState(await api.resolveBoardItem(boardItemId));
      showToast("看板事项已处理");
    } catch (err) {
      setError(err.message);
    }
  }

  async function resolveConnection(requestId, action) {
    try {
      setState(await api.resolveConnectionRequest(requestId, action));
      showToast(action === "reject" ? "已拒绝这个 Agent 好友申请" : "已接受申请，双方 Agent 会话已建立");
      setDrawer("workbench");
    } catch (err) {
      setError(err.message);
    }
  }

  async function logout() {
    await api.logout().catch(() => {});
    localStorage.removeItem("agent_comm_token");
    setAuth(null);
    setState(null);
  }

  if (!auth) return <LoginScreen onLogin={setAuth} />;
  if (loading) return <div className="boot">正在打开智能员工通信...</div>;
  if (!state) return <div className="boot error">无法载入：{error}</div>;

  return (
    <div className="app-shell">
      <aside className="agent-rail">
        <div className="rail-title">{state.org.name}<br />Agent</div>
        <div className="rail-agents">
          {state.agents.map((agent) => (
            <button
              key={agent.id}
              className={agent.id === activeAgent?.id ? "rail-agent active" : "rail-agent"}
              title={`${agent.name} / ${agent.accountId}`}
              onClick={() => selectAgent(agent)}
            >
              <Avatar item={agent} />
              {(agent.contacts.some((contact) => contact.approvals.some((approval) => approval.status === "pending")) || agent.boardItems?.length > 0) && (
                <span className="rail-dot">{agent.contacts.reduce((sum, contact) => sum + contact.approvals.filter((approval) => approval.status === "pending").length, 0) + (agent.boardItems?.length || 0)}</span>
              )}
            </button>
          ))}
          <button className="rail-agent dashed" title="创建我的 Agent" onClick={() => setDrawer("createAgent")}>+</button>
        </div>
        <button className={drawer === "workbench" ? "rail-work active" : "rail-work"} onClick={() => setDrawer("workbench")}>
          台
          {state.incomingRequests.length > 0 && <span className="rail-dot">{state.incomingRequests.length}</span>}
        </button>
      </aside>

      <aside className="contact-pane">
        <div className="account-bar">
          <span>{state.user.name}</span>
          <button onClick={logout}>退出</button>
        </div>
        <div className="search-row">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`搜索${activeAgent?.short || ""}的 Agent 好友`} />
          <button onClick={() => setDrawer("addById")}>+</button>
        </div>
        <div className="pane-label">{activeAgent?.name || "我的 Agent"}的好友</div>
        <div className="contact-list">
          {visibleContacts.map((contact) => (
            <button
              key={contact.id}
              className={activeContact?.id === contact.id ? "contact active" : "contact"}
              onClick={() => selectContact(contact)}
            >
              <Avatar item={contact} />
              <div className="contact-main">
                <div className="contact-top">
                  <strong>{contact.name}</strong>
                  <span>{contact.time}</span>
                </div>
                <div className="preview">{contact.preview}</div>
              </div>
              {contact.unread > 0 && <span className="unread">{contact.unread}</span>}
            </button>
          ))}
          {visibleContacts.length === 0 && (
            <FirstContactGuide activeAgent={activeAgent} setDrawer={setDrawer} />
          )}
        </div>
      </aside>

      <main className="chat">
        {activeAgent && activeContact ? (
          <>
            <header className="chat-head">
              <div>
                <h1>{activeContact.name}</h1>
                <p>{activeAgent.name} · 智能员工对智能员工 · 人类不能直接对外发言</p>
              </div>
              <div className="head-actions">
                <Badge>自动同步中</Badge>
                <Badge tone={activeContact.mode === "supervised" ? "orange" : "green"}>{activeContact.mode === "supervised" ? "监管模式" : "自动模式"}</Badge>
                {activeContact.approvals.some((item) => item.status === "pending") && (
                  <Badge tone="orange">{activeContact.approvals.filter((item) => item.status === "pending").length} 个待确认</Badge>
                )}
                {activeContact.boardItems?.length > 0 && <Badge tone="orange">{activeContact.boardItems.length} 个看板提醒</Badge>}
                <button onClick={() => changeMode(activeContact.mode === "supervised" ? "auto" : "supervised")}>{activeContact.mode === "supervised" ? "切自动" : "切监管"}</button>
                <button onClick={() => setDrawer("approvals")}>待办</button>
                <button onClick={() => setDrawer("board")}>看板</button>
                <button onClick={() => setDrawer("history")}>聊天记录</button>
              </div>
            </header>

            <section className="messages">
              <div className="time-chip">共享 Agent 会话</div>
              {activeContact.messages.map((message) => (
                <div key={message.id} className={`message-row ${message.kind}`}>
                  {message.kind === "in" && <Avatar item={activeContact} />}
                  <div className={`bubble ${message.kind}`}>
                    {message.text}
                    {message.autoSent && <small>自动回复 · {message.riskLevel || "low"}</small>}
                  </div>
                  {message.kind === "out" && <Avatar item={activeAgent} />}
                </div>
              ))}
            </section>

            <footer className="composer">
              <div className="composer-tools">
                <button onClick={() => setDrawer("instructions")}>指令记录</button>
                <button onClick={() => setDrawer("logs")}>操作记录</button>
                <button onClick={() => chooseAttachment("截图")}>截图</button>
                <button onClick={() => chooseAttachment("图片")}>图片</button>
                <button onClick={() => chooseAttachment("文件")}>文件</button>
                <span>仅我的 Agent 可见，不会直接发给对方</span>
              </div>
              <input
                ref={fileInputRef}
                className="hidden-file-input"
                type="file"
                accept={state.ai?.attachmentPolicy?.allowedTypes?.join(",")}
                onChange={attach}
              />
              <div className="composer-input">
                <textarea
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                  placeholder={`对${activeAgent.name}说：例如，这个款最多先问 50 件，语气客气一点。`}
                />
                <button onClick={sendInstruction}>交给 Agent</button>
              </div>
            </footer>
          </>
        ) : (
          <FirstUseMain activeAgent={activeAgent} setDrawer={setDrawer} />
        )}
      </main>

      {drawer !== "none" && (
        <Drawer
          drawer={drawer}
          setDrawer={setDrawer}
          state={state}
          setState={setState}
          activeAgent={activeAgent}
          activeContact={activeContact}
          approvals={allApprovals}
          resolve={resolve}
          resolveWithPayload={resolveWithPayload}
          boardItems={allBoardItems}
          resolveBoardItem={resolveBoardItem}
          resolveConnection={resolveConnection}
          showToast={showToast}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
      {error && <button className="error-toast" onClick={() => setError("")}>{error}</button>}
    </div>
  );
}

function Drawer({ drawer, setDrawer, state, setState, activeAgent, activeContact, approvals, resolve, resolveWithPayload, boardItems, resolveBoardItem, resolveConnection, showToast }) {
  const titles = {
    addById: "输入 Agent ID 添加",
    createAgent: "创建我的 Agent",
    invites: "邀请合作方注册",
    admin: "运营后台",
    workbench: "老板工作台",
    approvals: "待办审批",
    board: "看板提醒",
    requests: "Agent 好友申请",
    history: "聊天记录",
    instructions: "指令记录",
    logs: "操作记录"
  };

  return (
    <aside className="drawer">
      <div className="drawer-head">
        <strong>{titles[drawer]}</strong>
        <button onClick={() => setDrawer("none")}>×</button>
      </div>
      {drawer === "addById" && <AddById hints={state.directoryHints} activeAgent={activeAgent} setState={setState} showToast={showToast} />}
      {drawer === "createAgent" && <CreateAgent setState={setState} showToast={showToast} />}
      {drawer === "invites" && <RegistrationInvites state={state} setState={setState} showToast={showToast} />}
      {drawer === "admin" && <AdminConsole showToast={showToast} />}
      {drawer === "workbench" && (
        <Workbench state={state} activeAgent={activeAgent} activeContact={activeContact} approvals={approvals} boardItems={boardItems} resolve={resolve} resolveConnection={resolveConnection} resolveBoardItem={resolveBoardItem} setDrawer={setDrawer} setState={setState} showToast={showToast} />
      )}
      {drawer === "approvals" && <Approvals approvals={approvals} resolve={resolve} resolveWithPayload={resolveWithPayload} />}
      {drawer === "board" && <BoardItems boardItems={boardItems} resolveBoardItem={resolveBoardItem} />}
      {drawer === "requests" && <ConnectionRequests requests={state.incomingRequests} resolveConnection={resolveConnection} />}
      {drawer === "history" && <History activeAgent={activeAgent} activeContact={activeContact} />}
      {drawer === "instructions" && <InstructionLog activeContact={activeContact} />}
      {drawer === "logs" && <Logs activeContact={activeContact} />}
    </aside>
  );
}

function AddById({ hints, activeAgent, setState, showToast }) {
  const [accountId, setAccountId] = useState("");
  const [found, setFound] = useState(null);
  const [error, setError] = useState("");

  async function lookup(id = accountId) {
    setError("");
    setFound(null);
    try {
      const result = await api.lookupAgent(id.trim());
      setFound(result);
      setAccountId(result.accountId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function add() {
    try {
      const next = await api.addContact(activeAgent.id, accountId.trim());
      setState(next);
      showToast("已发送 Agent 好友申请，等待对方确认");
    } catch (err) {
      setError(err.message);
    }
  }

  if (!activeAgent) return <EmptyState title="先创建自己的 Agent" body="创建后才能用它添加外部 Agent。" />;

  return (
    <div className="drawer-body">
      <label className="field">
        <span>对方 Agent ID</span>
        <div className="inline-input">
          <input value={accountId} onChange={(event) => setAccountId(event.target.value)} placeholder="例如 supplier-c-sales-018" />
          <button onClick={() => lookup()}>查找</button>
        </div>
      </label>
      <div className="hint-list">
        {hints.map((idText) => <button key={idText} onClick={() => lookup(idText)}>{idText}</button>)}
      </div>
      {found && (
        <div className="directory-card">
          <div className="directory-top">
            <Avatar item={found} large />
            <div>
              <strong>{found.name}</strong>
              <span>{found.company} · {found.type}</span>
              <small>{found.accountId}</small>
            </div>
          </div>
          <div className="capability">
            <b>可自动处理</b>
            {found.can.map((item) => <span key={item}>{item}</span>)}
          </div>
          <div className="capability approval">
            <b>需要负责人确认</b>
            {found.needsApproval.map((item) => <span key={item}>{item}</span>)}
          </div>
          <button className="primary full" onClick={add} disabled={found.isOwnOrg}>添加到{activeAgent.name}</button>
        </div>
      )}
      {error && <div className="inline-error">{error}</div>}
    </div>
  );
}

function CreateAgent({ setState, showToast }) {
  const [form, setForm] = useState({ name: "", type: "", accountId: "", short: "" });
  const [error, setError] = useState("");

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function create() {
    try {
      const next = await api.createAgent(form);
      setState(next);
      showToast("已创建我的 Agent，可以继续添加好友");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="drawer-body">
      <label className="field"><span>Agent 名称</span><input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="我的选品智能员工" /></label>
      <label className="field"><span>Agent ID</span><input value={form.accountId} onChange={(event) => update("accountId", event.target.value)} placeholder="brand-buy-001" /></label>
      <label className="field"><span>职责</span><input value={form.type} onChange={(event) => update("type", event.target.value)} placeholder="选品智能员工" /></label>
      <label className="field"><span>头像字</span><input value={form.short} onChange={(event) => update("short", event.target.value)} placeholder="选" /></label>
      <button className="primary full" onClick={create}>创建 Agent</button>
      {error && <div className="inline-error">{error}</div>}
    </div>
  );
}

function RegistrationInvites({ state, setState, showToast }) {
  const [form, setForm] = useState({ label: "", email: "", expiresInDays: 14 });
  const [created, setCreated] = useState(null);
  const [error, setError] = useState("");

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function create() {
    setError("");
    setCreated(null);
    try {
      const result = await api.createRegistrationInvite(form);
      setState(result.state);
      setCreated(result);
      showToast("已生成注册邀请");
    } catch (err) {
      setError(err.message);
    }
  }

  async function copy(text) {
    await navigator.clipboard?.writeText(text).catch(() => {});
    showToast("已复制邀请信息");
  }

  return (
    <div className="drawer-body">
      <label className="field"><span>邀请备注</span><input value={form.label} onChange={(event) => update("label", event.target.value)} placeholder="例如 星河服饰 张经理" /></label>
      <label className="field"><span>限定邮箱</span><input value={form.email} onChange={(event) => update("email", event.target.value)} placeholder="可选，填写后只能这个邮箱注册" /></label>
      <label className="field"><span>有效天数</span><input type="number" min="1" max="90" value={form.expiresInDays} onChange={(event) => update("expiresInDays", event.target.value)} /></label>
      <div className="inline-notice">每个邀请码只能使用一次。对方完成注册后，这个邀请码会自动失效。</div>
      <button className="primary full" onClick={create}>生成邀请</button>
      {created && (
        <div className="created-invite">
          <span>邀请码</span>
          <code>{created.inviteCode}</code>
          {created.registrationUrl && (
            <>
              <span>注册链接</span>
              <input readOnly value={created.registrationUrl} />
            </>
          )}
          <button onClick={() => copy(created.registrationUrl || created.inviteCode)}>复制给对方</button>
        </div>
      )}
      <h3>最近邀请</h3>
      <div className="invite-list">
        {state.registrationInvites?.length ? state.registrationInvites.map((invite) => (
          <div className="invite-row" key={invite.id}>
            <strong>{invite.label}</strong>
            <span>{invite.email || "不限邮箱"} · {invite.usedCount}/1 已用</span>
            <small>{invite.expiresAt ? `有效至 ${new Date(invite.expiresAt).toLocaleDateString()}` : "长期有效"}</small>
          </div>
        )) : <EmptyState title="暂无邀请" body="生成后会显示在这里。" />}
      </div>
      {error && <div className="inline-error">{error}</div>}
    </div>
  );
}

function AdminConsole({ showToast }) {
  const [overview, setOverview] = useState(null);
  const [backups, setBackups] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    setError("");
    try {
      const [adminResult, backupResult] = await Promise.all([api.adminOverview(), api.adminBackups()]);
      setOverview(adminResult);
      setBackups(backupResult.backups || []);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function run(label, action) {
    setBusy(label);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function toggleUser(user) {
    const nextStatus = user.status === "active" ? "suspended" : "active";
    await run("user", async () => {
      setOverview(await api.adminUpdateUser(user.id, { status: nextStatus }));
      showToast(nextStatus === "active" ? "用户已启用" : "用户已停用");
    });
  }

  async function updateRole(user, role) {
    await run("role", async () => {
      setOverview(await api.adminUpdateUser(user.id, { role }));
      showToast("用户角色已更新");
    });
  }

  async function toggleOrg(org) {
    const nextStatus = org.status === "active" ? "suspended" : "active";
    await run("org", async () => {
      setOverview(await api.adminUpdateOrganization(org.id, { status: nextStatus }));
      showToast(nextStatus === "active" ? "组织已启用" : "组织已停用");
    });
  }

  async function cleanup() {
    if (!window.confirm("清理测试账号、测试组织和测试邀请前会自动创建备份，确认继续？")) return;
    await run("cleanup", async () => {
      const result = await api.adminCleanupTestData();
      setOverview(result.overview);
      const backupResult = await api.adminBackups();
      setBackups(backupResult.backups || []);
      showToast(`已清理 ${result.result.users} 个测试用户和 ${result.result.invites} 个测试邀请`);
    });
  }

  async function createBackup() {
    await run("backup", async () => {
      const result = await api.adminCreateBackup();
      setBackups(result.backups || []);
      showToast(`已创建备份 ${result.backup.name}`);
    });
  }

  async function restoreBackup(name) {
    if (!window.confirm(`恢复备份 ${name}？当前数据会先自动备份。`)) return;
    await run("restore", async () => {
      const result = await api.adminRestoreBackup(name);
      setOverview(result.overview);
      const backupResult = await api.adminBackups();
      setBackups(backupResult.backups || []);
      showToast("备份已恢复");
    });
  }

  if (!overview) {
    return (
      <div className="drawer-body">
        <EmptyState title="正在读取运营数据" body="稍等片刻。" />
        {error && <div className="inline-error">{error}</div>}
      </div>
    );
  }

  return (
    <div className="drawer-body admin-console">
      <div className="metrics">
        <div><strong>{overview.counts.organizations}</strong><span>组织</span></div>
        <div><strong>{overview.counts.users}</strong><span>用户</span></div>
        <div><strong>{overview.counts.sessions}</strong><span>有效会话</span></div>
        <div><strong>{overview.counts.riskEvents24h}</strong><span>24h 风控事件</span></div>
        <div><strong>{overview.counts.aiCalls24h || 0}</strong><span>24h Agent 调用</span></div>
        <div><strong>{overview.counts.aiFailed24h || 0}</strong><span>24h 模型失败</span></div>
        <div><strong>{overview.counts.openBoardItems || 0}</strong><span>看板未处理</span></div>
        <div><strong>{overview.counts.fileUploads24h || 0}</strong><span>24h 上下文文件</span></div>
      </div>
      <div className="work-actions">
        <button onClick={cleanup} disabled={!!busy}>清理测试数据</button>
        <button onClick={createBackup} disabled={!!busy}>创建备份</button>
        <button onClick={load} disabled={!!busy}>刷新后台</button>
      </div>

      <h3>基础风控</h3>
      <div className="admin-grid">
        <div><strong>{overview.risk.failedLogins24h}</strong><span>登录失败</span></div>
        <div><strong>{overview.risk.verificationCodes24h}</strong><span>验证码发送</span></div>
        <div><strong>{overview.risk.passwordReset24h}</strong><span>密码找回</span></div>
      </div>

      <h3>AI 接入准备</h3>
      <div className="admin-grid">
        <div><strong>{overview.ai?.runtimeStatus || "simulated"}</strong><span>运行状态</span></div>
        <div><strong>{overview.ai?.apiKeyConfigured ? "已配置" : "未配置"}</strong><span>API Key</span></div>
        <div><strong>{overview.ai?.estimatedTokens24h || 0}</strong><span>24h 估算 tokens</span></div>
        <div><strong>{overview.ai?.orgDailyLimit ?? 0}</strong><span>组织日额度</span></div>
        <div><strong>{overview.ai?.userDailyLimit ?? 0}</strong><span>用户日额度</span></div>
        <div><strong>{humanBytes(overview.ai?.attachmentMaxBytes || 0)}</strong><span>单文件上限</span></div>
      </div>
      <div className="admin-policy">
        <span>模型</span>
        <code>{overview.ai?.provider || "disabled"} / {overview.ai?.model || "agent-draft-simulator-v0"}</code>
        <span>允许类型</span>
        <code>{overview.ai?.attachmentAllowedTypes?.join(", ") || "未配置"}</code>
      </div>

      <h3>Agent 调用日志</h3>
      <div className="admin-list">
        {overview.ai?.recentEvents?.length ? overview.ai.recentEvents.map((event) => (
          <div className="admin-row ai-event" key={event.id}>
            <div>
              <strong>{event.action} · {event.status}</strong>
              <span>{event.organizationName} · {event.agentName || "Agent"} · {event.estimatedTokens} tokens</span>
              <small>{new Date(event.time).toLocaleString()} {event.riskLevel ? `· ${event.riskLevel}` : ""} {event.errorType ? `· ${event.errorType}` : ""} {event.reason ? `· ${event.reason}` : ""}</small>
            </div>
          </div>
        )) : <EmptyState title="还没有 Agent 调用日志" body="负责人给 Agent 下内部指令后会出现在这里。" />}
      </div>

      <h3>上下文文件记录</h3>
      <div className="admin-list">
        {overview.ai?.recentUploads?.length ? overview.ai.recentUploads.map((upload) => (
          <div className="admin-row ai-event" key={upload.id}>
            <div>
              <strong>{upload.filename}</strong>
              <span>{upload.organizationName} · {upload.kind} · {humanBytes(upload.sizeBytes)}</span>
              <small>{upload.mimeType} · {new Date(upload.time).toLocaleString()}</small>
            </div>
          </div>
        )) : <EmptyState title="还没有上下文文件" body="文件通过权限和大小校验后会记录在这里。" />}
      </div>

      <h3>组织管理</h3>
      <div className="admin-list">
        {overview.organizations.map((org) => (
          <div className="admin-row" key={org.id}>
            <div>
              <strong>{org.name}</strong>
              <span>{org.userCount} 用户 · {org.agentCount} Agent · {org.activeSessionCount} 会话</span>
            </div>
            <button onClick={() => toggleOrg(org)} disabled={!!busy}>{org.status === "active" ? "停用" : "启用"}</button>
          </div>
        ))}
      </div>

      <h3>用户管理</h3>
      <div className="admin-list">
        {overview.users.map((user) => (
          <div className="admin-row user" key={user.id}>
            <div>
              <strong>{user.name}</strong>
              <span>{user.email}</span>
              <small>{user.organizationName}</small>
            </div>
            <select value={user.role} onChange={(event) => updateRole(user, event.target.value)} disabled={!!busy}>
              <option value="member">成员</option>
              <option value="owner">负责人</option>
              <option value="platform_admin">平台管理员</option>
            </select>
            <button onClick={() => toggleUser(user)} disabled={!!busy}>{user.status === "active" ? "停用" : "启用"}</button>
          </div>
        ))}
      </div>

      <h3>备份恢复</h3>
      <div className="admin-list">
        {backups.length ? backups.map((backup) => (
          <div className="admin-row" key={backup.name}>
            <div>
              <strong>{backup.name}</strong>
              <span>{new Date(backup.createdAt).toLocaleString()} · {Math.ceil(backup.size / 1024)} KB</span>
            </div>
            <button onClick={() => restoreBackup(backup.name)} disabled={!!busy}>恢复</button>
          </div>
        )) : <EmptyState title="还没有备份" body="创建手动备份后会显示在这里。" />}
      </div>
      {error && <div className="inline-error">{error}</div>}
    </div>
  );
}

function Workbench({ state, activeAgent, activeContact, approvals, boardItems, resolve, resolveConnection, resolveBoardItem, setDrawer, setState, showToast }) {
  const totals = {
    agents: state.agents.length,
    contacts: state.agents.reduce((sum, agent) => sum + agent.contacts.length, 0),
    approvals: approvals.length,
    board: boardItems.length,
    requests: state.incomingRequests.length,
    logs: state.agents.reduce((sum, agent) => sum + agent.contacts.reduce((inner, contact) => inner + contact.logs.length, 0), 0)
  };

  async function reset() {
    await api.reset();
    setState(await api.state());
    showToast("演示数据已重置");
  }

  return (
    <div className="drawer-body">
      <div className="metrics">
        <div><strong>{totals.agents}</strong><span>我的 Agent</span></div>
        <div><strong>{totals.contacts}</strong><span>Agent 好友</span></div>
        <div><strong>{totals.approvals}</strong><span>待审批</span></div>
        <div><strong>{totals.board}</strong><span>看板提醒</span></div>
        <div><strong>{totals.requests}</strong><span>好友申请</span></div>
      </div>
      <div className="work-actions">
        <button onClick={() => setDrawer("requests")}>好友申请</button>
        {state.admin?.isPlatformAdmin && <button onClick={() => setDrawer("invites")}>邀请合作方注册</button>}
        <button onClick={() => setDrawer("createAgent")}>创建 Agent</button>
        <button onClick={() => setDrawer("addById")}>输入 ID 添加</button>
        <button onClick={() => setDrawer("logs")}>当前会话记录</button>
        <button onClick={() => setDrawer("board")}>看板提醒</button>
        {state.admin?.isPlatformAdmin && <button onClick={() => setDrawer("admin")}>运营后台</button>}
        {state.featureFlags?.allowDemo && <button onClick={reset}>重置演示</button>}
      </div>
      {activeAgent && (
        <div className="onboarding-card">
          <span>把这个 ID 发给合作方，对方就能申请添加你的 Agent</span>
          <code>{activeAgent.accountId}</code>
        </div>
      )}
      {state.admin?.isPlatformAdmin && (
        <>
          <h3>注册邀请</h3>
          {state.registrationInvites?.length ? (
            <div className="invite-list compact">
              {state.registrationInvites.slice(0, 3).map((invite) => (
                <div className="invite-row" key={invite.id}>
                  <strong>{invite.label}</strong>
                  <span>{invite.email || "不限邮箱"} · {invite.usedCount}/1 已用</span>
                </div>
              ))}
            </div>
          ) : <EmptyState title="还没有注册邀请" body="创建邀请后，对方才能用邮箱验证码注册。" />}
        </>
      )}
      <h3>Agent 好友申请</h3>
      <ConnectionRequests requests={state.incomingRequests} resolveConnection={resolveConnection} compact />
      {state.outgoingRequests.length > 0 && (
        <>
          <h3>等待对方确认</h3>
          <OutgoingRequests requests={state.outgoingRequests} />
        </>
      )}
      <h3>待你确认</h3>
      <Approvals approvals={approvals} resolve={resolve} compact />
      <h3>看板提醒</h3>
      <BoardItems boardItems={boardItems} resolveBoardItem={resolveBoardItem} compact />
      <h3>当前 Agent</h3>
      {activeAgent ? (
        <div className="summary-box">
          <Avatar item={activeAgent} large />
          <div>
            <strong>{activeAgent.name}</strong>
            <span>{activeAgent.accountId}</span>
            <p>{activeAgent.type} · {activeAgent.approvalMode}</p>
            {activeContact && <p>正在与 {activeContact.name} 会话</p>}
          </div>
        </div>
      ) : <EmptyState title="还没有 Agent" body="先创建一个自己的 Agent。" />}
    </div>
  );
}

function ConnectionRequests({ requests, resolveConnection, compact = false }) {
  if (!requests.length) {
    return <EmptyState title="没有新的 Agent 好友申请" body="当外部组织通过 Agent ID 添加你时，会先出现在这里。" />;
  }
  return (
    <div className={compact ? "approval-list compact" : "approval-list"}>
      {requests.map((request) => (
        <div className="approval-card" key={request.id}>
          <div className="approval-meta">
            <Badge tone="orange">待确认</Badge>
            <span>{request.time}</span>
          </div>
          <div className="request-pair">
            <Avatar item={request.requester} />
            <div>
              <strong>{request.requester.name}</strong>
              <p>{request.requester.company} · {request.requester.accountId}</p>
              <small>申请添加你的 {request.target.name}</small>
            </div>
          </div>
          <div className="approval-actions">
            <button onClick={() => resolveConnection(request.id, "reject")}>拒绝</button>
            <button className="primary" onClick={() => resolveConnection(request.id, "accept")}>接受并建立会话</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function OutgoingRequests({ requests }) {
  return (
    <div className="approval-list compact">
      {requests.map((request) => (
        <div className="approval-card muted" key={request.id}>
          <div className="approval-meta">
            <Badge>已发送</Badge>
            <span>{request.time}</span>
          </div>
          <p>{request.target.name} 还未确认你的 Agent 好友申请。</p>
        </div>
      ))}
    </div>
  );
}

function Approvals({ approvals, resolve, resolveWithPayload, compact = false }) {
  if (!approvals.length) {
    return <EmptyState title="没有待审批事项" body="当自己的 Agent 准备对外承诺金额、交期或责任时，会在这里停下来。" />;
  }
  return (
    <div className={compact ? "approval-list compact" : "approval-list"}>
      {approvals.map(({ agent, contact, approval }) => (
        <ApprovalCard
          key={approval.id}
          agent={agent}
          contact={contact}
          approval={approval}
          resolve={resolve}
          resolveWithPayload={resolveWithPayload}
          compact={compact}
        />
      ))}
    </div>
  );
}

function ApprovalCard({ agent, contact, approval, resolve, resolveWithPayload, compact }) {
  const [modifiedText, setModifiedText] = useState(approval.text);
  const [rewriteText, setRewriteText] = useState("");
  const riskTone = approval.riskLevel === "high" ? "orange" : approval.riskLevel === "medium" ? "orange" : "green";
  const canPayload = typeof resolveWithPayload === "function" && !compact;
  return (
    <div className="approval-card">
      <div className="approval-meta">
        <Badge tone={riskTone}>{approval.risk}</Badge>
        <span>{agent.name} → {contact.name}</span>
      </div>
      <strong>{approval.type}</strong>
      <p>{approval.text}</p>
      {!!approval.riskReasons?.length && <small>{approval.riskReasons.join("；")}</small>}
      {!!approval.ruleOverrides?.length && <small>系统覆盖：{approval.ruleOverrides.join("，")}</small>}
      {canPayload && (
        <>
          <textarea className="approval-editor" value={modifiedText} onChange={(event) => setModifiedText(event.target.value)} />
          <input className="approval-rewrite" value={rewriteText} onChange={(event) => setRewriteText(event.target.value)} placeholder="追加内部指令，让 Agent 重写" />
        </>
      )}
      <div className="approval-actions">
        <button onClick={() => resolve(approval.id, "reject")}>拒绝</button>
        <button onClick={() => resolve(approval.id, "supervise")}>切监管</button>
        {canPayload && <button onClick={() => rewriteText.trim() && resolveWithPayload(approval.id, "rewrite", { text: rewriteText })}>重写</button>}
        {canPayload && <button onClick={() => resolveWithPayload(approval.id, "modify", { text: modifiedText })}>修改后发送</button>}
        <button className="primary" onClick={() => resolve(approval.id, "approve")}>批准发送</button>
      </div>
    </div>
  );
}

function BoardItems({ boardItems, resolveBoardItem, compact = false }) {
  if (!boardItems.length) {
    return <EmptyState title="没有看板提醒" body="模型失败、缺资料、人工确认和保护上限会出现在这里。" />;
  }
  return (
    <div className={compact ? "approval-list compact" : "approval-list"}>
      {boardItems.map(({ agent, item }) => (
        <div className="approval-card" key={item.id}>
          <div className="approval-meta">
            <Badge tone={item.severity === "high" ? "orange" : "green"}>{item.severity}</Badge>
            <span>{agent.name} · {item.time}</span>
          </div>
          <strong>{item.title}</strong>
          <p>{item.body}</p>
          <div className="approval-actions">
            <button className="primary" onClick={() => resolveBoardItem(item.id)}>标记已处理</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function History({ activeAgent, activeContact }) {
  if (!activeContact) return <EmptyState title="没有会话" body="先添加一个 Agent 好友。" />;
  return (
    <div className="drawer-body timeline">
      {activeContact.messages.map((message) => (
        <div className="timeline-row" key={message.id}>
          <span className={`timeline-kind ${message.kind}`}>{message.kind === "out" ? activeAgent.short : message.kind === "in" ? activeContact.short : "系"}</span>
          <p>{message.text}</p>
        </div>
      ))}
    </div>
  );
}

function InstructionLog({ activeContact }) {
  if (!activeContact) return <EmptyState title="没有内部指令" body="先选择一个会话。" />;
  return (
    <div className="drawer-body timeline">
      {activeContact.instructions.length ? activeContact.instructions.map((item) => (
        <div className="timeline-row" key={item.id}>
          <time>{item.time}</time>
          <p>{item.text}</p>
        </div>
      )) : <EmptyState title="还没有内部指令" body="底部输入框发出的内容只会进入这里，作为自己的 Agent 的工作上下文。" />}
    </div>
  );
}

function Logs({ activeContact }) {
  if (!activeContact) return <EmptyState title="没有操作记录" body="先选择一个会话。" />;
  return (
    <div className="drawer-body timeline">
      {activeContact.logs.map((item) => (
        <div className="timeline-row" key={item.id}>
          <time>{item.time}</time>
          <strong>{item.title}</strong>
          <p>{item.body}</p>
        </div>
      ))}
    </div>
  );
}

export default App;
