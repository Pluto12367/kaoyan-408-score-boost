// V14 内容生产轨 — 2019 真题大题解析/rubric 草稿（Q41–Q47）。
// 状态：AI 草稿（D-5），必须经具名教研互审后方可导入（RULE-10）。
// rubric 遵循 rubric-v1 JSON 规范（totalPoints = Σ criteria.points）。
// ⚠ 2019 各大题官方单题分值待官方分值表（bundle 中 score=null）：以下 totalPoints 与
//   子问分值拆分为草稿拟定（合计 70 分，与 40×2+70=150 卷面结构一致），解析中已显式标注「待核」。
// 图依赖：Q47 网络拓扑（关键 IP 已随题面保留并解码）；Q42 按题设文字设计。
export const draftsEssay = {
  41: {
    analysis:
      '(1) 基本设计思想：三步法，全程只改指针、不开新空间——\n' +
      '① 快慢指针找中点：slow 每走 1 步、fast 每走 2 步，fast 到尾时 slow 在中点（n 偶数时 slow 指向前半最后结点）；\n' +
      '② 断链并把后半段（slow 之后的结点）**逆置**；③ 把前半段与逆置后的后半段按「前段一个、后段一个」交替合并。\n' +
      '得到 L′ = (a1, an, a2, an−1, …)。\n' +
      '(2) 代码（C 语言）：\n' +
      'void rearrange(NODE *head) {\n' +
      '    NODE *p = head, *q = head, *s;             // 快慢指针\n' +
      '    while (q->next != NULL) {                  // 找中点：p 到前半末尾\n' +
      '        p = p->next; q = q->next;\n' +
      '        if (q->next != NULL) q = q->next;\n' +
      '    }\n' +
      '    q = p->next; p->next = NULL;               // 断成两段，q 为后半段首\n' +
      '    s = NULL;                                  // 逆置后半段\n' +
      '    while (q != NULL) {\n' +
      '        NODE *t = q->next; q->next = s; s = q; q = t;\n' +
      '    }\n' +
      '    NODE *m = head->next; q = s;               // m 前半首结点，q 后半首\n' +
      '    p = head;                                  // 交替合并\n' +
      '    while (q != NULL) {\n' +
      '        NODE *t1 = m->next, *t2 = q->next;\n' +
      '        p->next = m; m->next = q; p = q;\n' +
      '        m = t1; q = t2;\n' +
      '    }\n' +
      '    if (m != NULL) p->next = m;                // 奇数个时前半多一个结点收尾\n' +
      '}\n' +
      '(3) 时间复杂度 O(n)（找中点、逆置、合并各一趟），空间复杂度 O(1)。\n' +
      '【各问分值为草稿拟定（本题合计 13 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 13,
      criteria: [
        {
          id: 'c1', description: '(1) 思想正确（找中点 + 后半逆置 + 交替合并）', points: 4,
          evidenceHint: '答案描述三步法',
          matchAny: ['中点', '逆置', '合并', '快慢'],
        },
        {
          id: 'c2', description: '(2) 代码正确：断链、逆置循环、交替拼接与奇偶收尾', points: 7,
          evidenceHint: '代码含三个阶段的完整指针操作',
          matchAny: ['next', 'while', 'NULL'],
        },
        {
          id: 'c3', description: '(2) 关键处有简要注释', points: 1,
          evidenceHint: '代码含注释',
          matchAny: ['//', '/*'],
        },
        {
          id: 'c4', description: '(3) 时间 O(n)', points: 1,
          evidenceHint: '答案给出线性复杂度',
          matchAny: ['O(n)'],
        },
      ],
    },
  },
  42: {
    analysis:
      '(1) 应选择**链式存储结构**：要求④入队/出队恒为 O(1)，顺序存储的扩容需要搬移元素（O(n)），\n' +
      '链式插入删除只改指针；要求③出队后空间可重复使用——出队结点不释放、保留供入队重用，链式可天然支持。\n' +
      '(2) 队列结构：带头结点的单链表，设 front（队头，出队端）与 rear（队尾，入队端）两个指针，\n' +
      '并保留出队后「空闲结点」的头指针 freeHead 供重用。\n' +
      '· 初始状态：front = rear = 头结点，freeHead = NULL（链表仅一个头结点）；\n' +
      '· 队空条件：front == rear（两指针重合，指向同一结点）；\n' +
      '· 队满条件：**不存在队满**——freeHead 为空且需要新结点时直接 malloc（空间只增不减）。\n' +
      '(3) 第一个元素入队后：从 freeHead 取结点（初始为空则新申请），链接到 rear 之后、rear 后移；\n' +
      '链表为 头结点 → x1，front 仍指头结点，rear 指向 x1 结点。\n' +
      '(4) 入队：从空闲结点链或新申请取结点 e；e->data = x; e->next = NULL; rear->next = e; rear = e。（O(1)）\n' +
      '出队：若 front == rear 则队空报错；否则 p = front->next; front->next = p->next; 若 p == rear 则 rear = front\n' +
      '（最后一个元素出队后 rear 回指头结点）；把 p 结点头插入空闲结点链（不释放，供重用）。（O(1)）\n' +
      '【各问分值为草稿拟定（本题合计 9 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 9,
      criteria: [
        {
          id: 'c1', description: '(1) 选择链式存储并给出理由（扩容 O(n) 破坏 ④、出队结点可重用）', points: 3,
          evidenceHint: '答案选链式并说明复杂度/重用理由',
          matchAny: ['链式', 'O(1)', '释放', '重用'],
        },
        {
          id: 'c2', description: '(2) 队空条件 front==rear；无队满（或 freeHead 空则新申请）', points: 2,
          evidenceHint: '答案给出队空判定与空间策略',
          matchAny: ['front', 'rear', '队空'],
        },
        {
          id: 'c3', description: '(4) 入队尾插 O(1)、出队头删并结点入空闲链 O(1)', points: 3,
          evidenceHint: '答案描述两操作的指针修改过程',
          matchAny: ['rear', 'front', 'next', '空闲'],
        },
        {
          id: 'c4', description: '(3) 首元素入队后状态描述正确（头结点→x1，rear 指向 x1）', points: 1,
          evidenceHint: '答案描述单元素状态',
          matchAny: ['rear', 'x1', '头结点'],
        },
      ],
    },
  },
  43: {
    analysis:
      '信号量设计：\n' +
      '· chopstick[0..n−1] = 1：第 i 根筷子（哲学家 i 左手侧）互斥；\n' +
      '· bowl = min(m, n−1)：**碗 + 防死锁限额**复合信号量——就餐人数受碗数 m 限制，且为防止「每人都拿住\n' +
      '  一根筷子等另一根」的循环等待，同时就餐人数不得超过 n−1（至少留一位不在取筷进程中，环即断）。\n' +
      '哲学家 i 的过程：\n' +
      'while (true) {\n' +
      '    思考;\n' +
      '    P(bowl);                        // 先竞争就餐资格（碗）\n' +
      '    P(chopstick[i]);                // 左筷\n' +
      '    P(chopstick[(i+1) % n]);        // 右筷\n' +
      '    就餐;\n' +
      '    V(chopstick[(i+1) % n]);\n' +
      '    V(chopstick[i]);\n' +
      '    V(bowl);                        // 归还碗与就餐资格\n' +
      '}\n' +
      '说明：先取碗后取筷，使同时取筷的哲学家 ≤ min(m, n−1) < n，环路等待条件被破坏，不会死锁；\n' +
      '碗尽时后来者等待，保证就餐人数尽可能多（受 m 与 n−1 的较小值约束）。\n' +
      '【各问分值为草稿拟定（本题合计 7 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 7,
      criteria: [
        {
          id: 'c1', description: '信号量定义：chopstick[i]=1 与 bowl=min(m, n−1) 并说明含义', points: 3,
          evidenceHint: '答案定义筷子互斥与碗/限额信号量',
          matchAny: ['chopstick', 'bowl', 'min', 'n−1'],
        },
        {
          id: 'c2', description: 'P/V 次序正确：P(bowl) 先于取两侧筷、就餐后逆序释放', points: 2,
          evidenceHint: '伪代码的 P/V 配对与顺序',
          matchAny: ['P(bowl)', 'P(chopstick', 'V(chopstick', 'V(bowl)'],
        },
        {
          id: 'c3', description: '防死锁说明（就餐人数 ≤ n−1 破坏循环等待）与尽可能多就餐', points: 2,
          evidenceHint: '答案说明限额防死锁的理由',
          matchAny: ['死锁', 'n−1', '循环'],
        },
      ],
    },
  },
  44: {
    analysis:
      '基础：簇 = 2 扇区 = 1024B；每磁道 200 扇区 = 100 簇；每柱面 10 磁道 = 1000 簇。\n' +
      '(1) 磁盘容量 = 300 柱面 × 10 磁道 × 200 扇区 × 512B = **307200000B（约 300MB）**。\n' +
      '(2) 磁头在 85 号柱面（簇号 85000~95999）。各请求簇所在柱面：100260 → 97；60005 → 58；\n' +
      '101660 → 99；110560 → 107。SSTF：85 → 97（100260，距 12）→ 99（101660，距 2）→ 107（110560，距 8）→\n' +
      '58（60005，距 49）。访问次序 = **100260、101660、110560、60005**。\n' +
      '(3) 簇 100530：柱面号 = ⌊100530/1000⌋ = 98，余 530；磁道号 = ⌊530/100⌋ = 5，余 30；\n' +
      '扇区号 = 30 × 2 = 60 → 物理地址 = **柱面 98、磁道 5、扇区 60**（簇内第 1 个扇区）。\n' +
      '簇号 → CHS 物理地址的转换由 I/O 系统的**设备驱动程序**完成（它掌握磁盘的物理几何参数）。\n' +
      '【各问分值为草稿拟定（本题合计 7 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 7,
      criteria: [
        {
          id: 'c1', description: '(1) 容量 307200000B ≈ 300MB', points: 2,
          evidenceHint: '答案给出 300MB（或 307200000B）',
          matchAny: ['300', '307200000'],
        },
        {
          id: 'c2', description: '(2) SSTF 访问次序 100260 → 101660 → 110560 → 60005', points: 3,
          evidenceHint: '答案给出完整次序',
          matchAny: ['100260', '101660', '110560', '60005'],
        },
        {
          id: 'c3', description: '(3) 物理地址 柱面 98/磁道 5/扇区 60，由设备驱动程序转换', points: 2,
          evidenceHint: '答案给出 CHS 与驱动程序',
          matchAny: ['98', '5', '60', '驱动'],
        },
      ],
    },
  },
  45: {
    analysis:
      '(1) f(10) = 10!：递归链 f1(10) → f1(9) → … → f1(1)，共调用 **11 次**；递归调用由**第 16 行的 call 指令**\n' +
      '（call f1）完成。\n' +
      '(2) 条件转移指令：**第 12 行 jle**（n ≤ 1 时跳转）；一定会使程序跳转执行的指令：**第 16 行 call**（转入\n' +
      'f1 入口）与**第 30 行 ret**（返回调用者）。\n' +
      '(3) 第 17 行虚拟地址 = call 指令地址 + 指令长度 = 00401025H + 5 = **0040102AH**。\n' +
      '相对寻址偏移量 = 目标地址 − (call 之后 PC 值) = 00401000H − 0040102AH = **FFFFFFD6H**（即 −42）。\n' +
      'call 的机器码为 E8 D6 FF FF FF——偏移量低字节 D6 存放在低地址 → M 采用**小端方式**。\n' +
      '(4) 13! = 6227020800 > 2³¹ − 1 = 2147483647 → int 累乘中途溢出（按 32 位补码截断），\n' +
      '返回值 1932053504 即溢出后的低位结果。修改：把 f1 的返回值类型与相关变量改为 **double**\n' +
      '（或 long long，需保证范围覆盖 13!）。\n' +
      '(5) imul 产生 64 位乘积（edx:eax）。当**高 32 位与低 32 位的符号不一致**（高 32 位不等于低 32 位\n' +
      '最高位的符号扩展）时，乘积无法用 32 位带符号数表示 → OF = 1。编译器在 imul 后应加一条\n' +
      '**jo**（overflow jump，溢出则转移）指令，跳到异常处理入口。\n' +
      '【各问分值为草稿拟定（本题合计 8 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 8,
      criteria: [
        {
          id: 'c1', description: '(1) 调用 11 次、由第 16 行 call 指令递归', points: 1,
          evidenceHint: '答案给出 11 次与 call',
          matchAny: ['11', 'call'],
        },
        {
          id: 'c2', description: '(2) 条件转移 = jle（第 12 行）；call 与 ret 一定跳转', points: 1,
          evidenceHint: '答案给出 jle/call/ret',
          matchAny: ['jle', 'call', 'ret'],
        },
        {
          id: 'c3', description: '(3) 第 17 行地址 0040102AH、偏移 FFFFFFD6H、小端方式', points: 3,
          evidenceHint: '答案给出 0040102A、FFFFFFD6 与小端',
          matchAny: ['0040102A', 'FFFFFFD6', 'D6', '小端'],
        },
        {
          id: 'c4', description: '(4) int 溢出解释 + 改为 double（或 long long）', points: 2,
          evidenceHint: '答案说明溢出与类型修改',
          matchAny: ['溢出', 'double', 'long long'],
        },
        {
          id: 'c5', description: '(5) OF=1 条件（高低 32 位符号不一致）+ 加 jo 指令', points: 1,
          evidenceHint: '答案给出符号不一致与 jo',
          matchAny: ['符号', 'jo'],
        },
      ],
    },
  },
  46: {
    analysis:
      '(1) 第 1 行 push 地址 00401000H，第 30 行 ret 地址 0040104AH，两者相距 0x4AH = 74B << 4KB；\n' +
      '同一 4KB 页范围为 00401000H~00401FFFH → 两指令**在同一页中**。\n' +
      '(2) 32 位主存地址划分：块大小 64B → **块内地址 = 低 6 位（第 5~0 位）**；\n' +
      '64 行、4 路组相联 → 组数 = 16 → **Cache 组号 = 第 9~6 位（4 位）**；\n' +
      '**标记 Tag = 高 22 位（第 31~10 位）**。\n' +
      '(3) 第 16 行 call 指令地址 00401025H：块地址 = 00401025H >> 6 = 65600 → 组号 = 65600 mod 16 = **0**，\n' +
      '故只可能在指令 Cache 的**第 0 组**命中。理由：直接由地址位决定——组号取主存地址第 9~6 位，\n' +
      '该指令所在主存块只能映射到固定组（组相联在同一组内多行间竞争，但组号唯一）。\n' +
      '【各问分值为草稿拟定（本题合计 13 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 13,
      criteria: [
        {
          id: 'c1', description: '(1) 同一页（地址差 74B < 4KB）', points: 3,
          evidenceHint: '答案给出同一页及理由',
          matchAny: ['同一页', '4KB', '页'],
        },
        {
          id: 'c2', description: '(2) 块内地址低 6 位、组号第 9~6 位（4 位）、Tag 高 22 位', points: 7,
          evidenceHint: '答案给出 6/4/22 位划分',
          matchAny: ['6', '4', '22', '组号'],
        },
        {
          id: 'c3', description: '(3) 只可能在第 0 组命中（地址位固定映射）', points: 3,
          evidenceHint: '答案给出第 0 组及地址映射理由',
          matchAny: ['0 组', '组号', '映射'],
        },
      ],
    },
  },
  47: {
    analysis:
      '(1) 子网划分（/26）：H1、H2 与 R 的 IF1 同属 192.168.1.0/26；H3、H4 与 IF2 同属 192.168.1.64/26；\n' +
      'IF3（192.168.1.253/30）连 Internet 侧设备。\n' +
      '· 设备 1 = **路由器**（连接 Internet，需三层转发与 NAT）；\n' +
      '· 设备 2 = **以太网交换机**（同网段 H1、H2 二层互连）；\n' +
      '· 设备 3 = **以太网交换机**（同网段 H3、H4 二层互连）。\n' +
      '(2) 需要 IP 地址的是**路由器（设备 1）的接口**；交换机工作在二层、接口不需 IP：\n' +
      '· IF1 = 192.168.1.1/26（H1、H2 的默认网关）；· IF2 = 192.168.1.65/26（H3、H4 的默认网关）；\n' +
      '· IF3 = 192.168.1.253/30（连接 Internet 的点对点链路）。\n' +
      '(3) 内网使用私有地址 192.168.1.0/24 → R 需提供 **NAT**（网络地址转换）服务，\n' +
      '把内网源地址转换为公网地址后访问 Internet。\n' +
      '(4) H3 发目的地址 192.168.1.127：192.168.1.64/26 的广播地址（主机位全 1）= 64+63 = 127 →\n' +
      '该子网内除 H3 外的所有主机都会接收 → **只有 H4** 收到该数据报（交换机会向同 VLAN 全端口洪泛，\n' +
      '但另一子网 H1、H2 被 R 隔离不接收）。\n' +
      '【各问分值为草稿拟定（本题合计 13 分），待官方分值表核定。】',
    rubric: {
      version: 1,
      totalPoints: 13,
      criteria: [
        {
          id: 'c1', description: '(1) 设备 1 = 路由器、设备 2/3 = 以太网交换机', points: 3,
          evidenceHint: '答案给出三类设备类型',
          matchAny: ['路由器', '交换机'],
        },
        {
          id: 'c2', description: '(2) 仅路由器接口需 IP：IF1=192.168.1.1、IF2=192.168.1.65、IF3=192.168.1.253', points: 4,
          evidenceHint: '答案给出三个接口地址',
          matchAny: ['192.168.1.1', '192.168.1.65', '192.168.1.253'],
        },
        {
          id: 'c3', description: '(3) R 需提供 NAT 服务', points: 2,
          evidenceHint: '答案给出 NAT',
          matchAny: ['NAT'],
        },
        {
          id: 'c4', description: '(4) 192.168.1.127 为 /26 广播地址，仅 H4 接收', points: 4,
          evidenceHint: '答案给出广播地址判定与 H4',
          matchAny: ['广播', 'H4', '127'],
        },
      ],
    },
  },
};
