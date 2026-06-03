export function createContact({
  id,
  ownerAgentId,
  peerAgentId,
  conversationId,
  unread = 0,
  preview = "已建立智能员工会话"
}) {
  return { id, ownerAgentId, peerAgentId, conversationId, unread, preview };
}

export const publicDirectorySeeds = [
  {
    id: "agent-supplier-c-sales",
    organizationId: "org-supplier-c",
    accountId: "supplier-c-sales-018",
    name: "供应商C销售智能员工",
    short: "织",
    color: "#087f73",
    company: "杭州云织服饰",
    owner: "林总",
    type: "销售智能员工",
    approvalMode: "半自动",
    can: ["回复新款资料、图片、面料和尺码", "查询现货库存和预计发货时间", "整理报价单和起批量信息"],
    needsApproval: ["改价", "赊账", "合同", "交期承诺", "正式下单确认"]
  },
  {
    id: "agent-photo-reception",
    organizationId: "org-photo-studio",
    accountId: "photo-studio-reception-006",
    name: "摄影工作室接待智能员工",
    short: "摄",
    color: "#6f5bd7",
    company: "一格摄影工作室",
    owner: "周店长",
    type: "接待智能员工",
    approvalMode: "半自动",
    can: ["查询预约档期", "说明套餐价格", "收集拍摄需求"],
    needsApproval: ["收定金", "改价", "承诺特殊交付时间"]
  }
];

function agent(id, organizationId, accountId, name, type, short, color, company, owner = "负责人") {
  return {
    id,
    organizationId,
    accountId,
    name,
    type,
    short,
    color,
    company,
    owner,
    approvalMode: "半自动",
    can: ["自动处理普通信息", "整理上下文", "识别需要负责人审批的事项"],
    needsApproval: ["金额承诺", "交期承诺", "合同责任", "最终下单", "退款或赔付"]
  };
}

export function createInitialData(hashPassword) {
  const now = new Date().toISOString();
  const aresOrg = { id: "org-ares", name: "Ares 电商工作室", createdAt: now };
  const supplierOrg = { id: "org-supplier-a", name: "供应商A", createdAt: now };
  const supplierCOrg = { id: "org-supplier-c", name: "杭州云织服饰", createdAt: now };
  const photoOrg = { id: "org-photo-studio", name: "一格摄影工作室", createdAt: now };

  const buy = agent("agent-ares-buy", aresOrg.id, "ares-buy-001", "我的采购智能员工", "采购智能员工", "采", "#1aad19", aresOrg.name, "Ares");
  const sales = agent("agent-ares-sales", aresOrg.id, "ares-sales-001", "我的销售智能员工", "销售智能员工", "销", "#3478f6", aresOrg.name, "Ares");
  const service = agent("agent-ares-service", aresOrg.id, "ares-service-001", "我的客服智能员工", "客服智能员工", "客", "#8f6a3f", aresOrg.name, "Ares");
  const finance = agent("agent-ares-finance", aresOrg.id, "ares-fin-001", "我的财务智能员工", "财务智能员工", "财", "#6f5bd7", aresOrg.name, "Ares");
  const supplierSales = agent("agent-supplier-a-sales", supplierOrg.id, "supplier-a-sales-001", "供应商A销售智能员工", "销售智能员工", "供", "#5b6f86", supplierOrg.name, "王经理");
  const supplierQuality = agent("agent-supplier-a-qc", supplierOrg.id, "supplier-a-qc-010", "供应商A质检智能员工", "质检智能员工", "检", "#087f73", supplierOrg.name, "质检负责人");
  const supplierFabric = agent("agent-supplier-b-fabric", supplierOrg.id, "supplier-b-fabric-002", "供应商B面料智能员工", "面料智能员工", "布", "#3478f6", "供应商B", "刘经理");
  const supplierFinance = agent("agent-supplier-a-finance", supplierOrg.id, "supplier-a-finance-009", "供应商A财务智能员工", "财务智能员工", "财", "#6f5bd7", supplierOrg.name, "财务负责人");
  const clientC = agent("agent-client-c-buy", "org-client-c", "client-c-buy-003", "客户C采购智能员工", "采购智能员工", "客", "#8f6a3f", "客户C", "陈总");

  const conversationA = "conv-ares-buy-supplier-a-sales";
  const conversationFabric = "conv-ares-buy-supplier-b-fabric";
  const conversationClient = "conv-ares-buy-client-c";
  const conversationFinance = "conv-ares-buy-supplier-a-finance";

  return {
    version: 3,
    createdAt: now,
    organizations: [
      aresOrg,
      supplierOrg,
      supplierCOrg,
      photoOrg,
      { id: "org-client-c", name: "客户C", createdAt: now }
    ],
    users: [
      {
        id: "user-ares-owner",
        organizationId: aresOrg.id,
        name: "Ares 老板",
        email: "boss@ares.test",
        passwordHash: hashPassword("ares123"),
        role: "owner",
        activeAgentId: buy.id,
        activeContactAgentId: supplierSales.id
      },
      {
        id: "user-supplier-a-owner",
        organizationId: supplierOrg.id,
        name: "供应商A 王经理",
        email: "supplier@a.test",
        passwordHash: hashPassword("supplier123"),
        role: "owner",
        activeAgentId: supplierSales.id,
        activeContactAgentId: buy.id
      }
    ],
    sessions: [],
    agents: [
      buy,
      sales,
      service,
      finance,
      supplierSales,
      supplierQuality,
      supplierFabric,
      supplierFinance,
      clientC,
      ...publicDirectorySeeds
    ],
    contacts: [
      createContact({ id: "contact-buy-supplier-a", ownerAgentId: buy.id, peerAgentId: supplierSales.id, conversationId: conversationA, unread: 1, preview: "库存 86 件，等待你确认 50 件意向" }),
      createContact({ id: "contact-supplier-a-buy", ownerAgentId: supplierSales.id, peerAgentId: buy.id, conversationId: conversationA, unread: 0, preview: "Ares 采购正在确认 0832 款库存和交期" }),
      createContact({ id: "contact-buy-fabric", ownerAgentId: buy.id, peerAgentId: supplierFabric.id, conversationId: conversationFabric, preview: "6201 款还缺面料成分" }),
      createContact({ id: "contact-buy-client", ownerAgentId: buy.id, peerAgentId: clientC.id, conversationId: conversationClient, unread: 2, preview: "100 件价格申请低于底线" }),
      createContact({ id: "contact-buy-finance", ownerAgentId: buy.id, peerAgentId: supplierFinance.id, conversationId: conversationFinance, preview: "本周对账发现 1 笔差异" }),
      createContact({ id: "contact-finance-supplier-finance", ownerAgentId: finance.id, peerAgentId: supplierFinance.id, conversationId: "conv-finance-supplier-finance", unread: 1, preview: "本周对账发现 1 笔差异" })
    ],
    connectionRequests: [
      {
        id: "conn-accepted-buy-supplier",
        requesterAgentId: buy.id,
        targetAgentId: supplierSales.id,
        status: "accepted",
        createdAt: now,
        resolvedAt: now
      },
      {
        id: "conn-sales-to-supplier",
        requesterAgentId: sales.id,
        targetAgentId: supplierSales.id,
        status: "pending",
        createdAt: now
      }
    ],
    conversations: [
      { id: conversationA, agentIds: [buy.id, supplierSales.id], createdAt: now },
      { id: conversationFabric, agentIds: [buy.id, supplierFabric.id], createdAt: now },
      { id: conversationClient, agentIds: [buy.id, clientC.id], createdAt: now },
      { id: conversationFinance, agentIds: [buy.id, supplierFinance.id], createdAt: now },
      { id: "conv-finance-supplier-finance", agentIds: [finance.id, supplierFinance.id], createdAt: now }
    ],
    messages: [
      { id: "msg-1", conversationId: conversationA, kind: "system", fromAgentId: null, text: "0832 款被标记为“可能下单”，采购智能员工自动向供应商确认库存和交期。", createdAt: now },
      { id: "msg-2", conversationId: conversationA, kind: "agent", fromAgentId: buy.id, text: "你好，请帮忙确认 0832 款黑色 M 码当前库存数量，以及最快发货时间。当前只确认信息，暂不下单。", createdAt: now },
      { id: "msg-3", conversationId: conversationA, kind: "agent", fromAgentId: supplierSales.id, text: "0832 款黑色 M 码现货 86 件。今天 18:00 前确认的话，最快明天可以发出。", createdAt: now },
      { id: "msg-4", conversationId: conversationA, kind: "agent", fromAgentId: buy.id, text: "已记录库存和交期，正在等待负责人确认是否生成下单意向。", createdAt: now },
      { id: "msg-5", conversationId: conversationA, kind: "system", fromAgentId: null, text: "这条会话没有人类对外输入框。负责人只能给自己的智能员工下内部指令，或审批待发送内容。", createdAt: now },
      { id: "msg-fabric-1", conversationId: conversationFabric, kind: "system", fromAgentId: null, text: "双方智能员工已建立会话，6201 款面料资料正在自动补全。", createdAt: now },
      { id: "msg-client-1", conversationId: conversationClient, kind: "system", fromAgentId: null, text: "客户C 100 件价格申请低于底线，已进入负责人确认。", createdAt: now },
      { id: "msg-finance-1", conversationId: conversationFinance, kind: "system", fromAgentId: null, text: "本周对账发现 1 笔差异，双方财务智能员工正在核对。", createdAt: now }
    ],
    approvals: [
      {
        id: "approval-1",
        conversationId: conversationA,
        ownerAgentId: buy.id,
        type: "下单意向",
        risk: "中风险",
        text: "我们先按黑色 M 码 50 件确认意向，请提供对应下单信息。最终付款前还需要我方确认。",
        status: "pending",
        createdAt: now
      }
    ],
    instructions: [
      { id: "ins-1", conversationId: conversationA, ownerAgentId: buy.id, text: "这个款先不要下太多，最多问 50 件的现货情况。", createdAt: now }
    ],
    logs: [
      { id: "log-1", conversationId: conversationA, ownerAgentId: buy.id, title: "系统生成老板待办", body: "事项：0832 款是否按 50 件生成下单意向。风险等级：中。", createdAt: now },
      { id: "log-2", conversationId: conversationA, ownerAgentId: supplierSales.id, title: "供应商A销售智能员工查询库存表", body: "查询：0832 / 黑色 / M。返回：现货 86 件，最快明天发。", createdAt: now },
      { id: "log-3", conversationId: conversationA, ownerAgentId: buy.id, title: "我的采购智能员工自动发送消息", body: "依据：0832 款被标记为可能下单。审批：无需审批。风险等级：低。", createdAt: now }
    ]
  };
}
