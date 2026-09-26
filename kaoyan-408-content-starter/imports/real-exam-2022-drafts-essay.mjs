// V14-P0 R3 — 2022 真题大题解析/rubric 草稿（Q41–Q47）。
// 状态：AI 草稿（D-5），必须经具名教研互审后方可导入（RULE-10）。解析自写原创。
// Q43 数据通路图、Q45 目录结构图、Q46 顺序约束图、Q47 拓扑图为图依赖，
// 采分点按文字化题面搭建并标注待核。Q46 的信号量解法可由题面文字完整推出。
export const draftsEssay = {
  41: {
    analysis:
      '顺序存储（数组下标 i 的孩子为 2i+1、2i+2，0 起）的二叉搜索树判定：对每个存在的结点，\n' +
      '其子树内所有值必须落在 (min, max) 开区间内。递归判定：visit(i, lo, hi)——\n' +
      '若 i ≥ ElemNum 或 SqBiTNode[i] = −1（结点不存在，其子树也视为空）返回 true；\n' +
      '若值不在 (lo, hi) 内返回 false；否则递归判定左子树 (lo, val) 与右子树 (val, hi)。\n' +
      '以 visit(0, −∞, +∞) 启动。时间 O(n)，空间 O(树高)。',
    rubric: {
      version: 1,
      totalPoints: 13,
      criteria: [
        {
          id: 'c1', description: '(1) 思想：利用「子树取值范围 (min,max)」的 BST 性质递归判定', points: 4,
          evidenceHint: '答案出现上下界/区间约束的递归思路',
          matchAny: ['范围', 'min', 'max', '上下界', '递归'],
        },
        {
          id: 'c2', description: '(1) 处理顺序存储结构（孩子下标 2i+1/2i+2、−1 表示空）', points: 3,
          evidenceHint: '答案给出数组下标的孩子计算与空结点处理',
          matchAny: ['2i+1', '2*i+1', '-1', 'ElemNum'],
        },
        {
          id: 'c3', description: '(2) 代码框架正确（递归函数、区间参数传递）', points: 3,
          evidenceHint: '代码含递归调用与区间参数',
          matchAny: ['return', 'if', '递归'],
        },
        {
          id: 'c4', description: '(2) 边界处理正确（空树/越界/−1 视为空子树）', points: 2,
          evidenceHint: '代码含下标越界与 −1 判空',
          matchAny: ['MAX_SIZE', 'ElemNum', '-1'],
        },
        {
          id: 'c5', description: '(2) 关键处注释、返回值语义正确（true/false）', points: 1,
          evidenceHint: '代码含注释与布尔返回',
          matchAny: ['//', 'true', 'false'],
        },
      ],
    },
  },
  42: {
    analysis:
      '(1) 求 n>100000 个数中最小的 10 个，平均比较次数尽可能少：\n' +
      '方案一（推荐）：维护一个容量为 10 的**大根堆**（Top-K）。先用前 10 个数建堆（O(10)），\n' +
      '其余每个数与堆顶比较：小于堆顶则替换并下滤（O(log 10)≈常数）。总比较次数 ≈ (n−10)×每次 1 次比较\n' +
      '（堆内下滤 10 个元素内比较 ≈ 2~3 次/替换，可视为常数级）。平均 O(n) 时间、O(1) 辅助空间。\n' +
      '方案二：比较-插入排序维护 10 个最小值有序数组，每数平均比较 ~5 次，同样 O(n)，常数略大。\n' +
      '(2) 时间复杂度 O(n)（每元素常数次比较）；空间复杂度 O(1)（只用 10 个元素的辅助数组/堆）。',
    rubric: {
      version: 1,
      totalPoints: 10,
      criteria: [
        {
          id: 'c1', description: '(1) 采用大根堆 Top-K 方案（前 10 建堆，其余与堆顶比较替换）', points: 4,
          evidenceHint: '答案描述堆维护最小 10 个数的流程',
          matchAny: ['堆', '堆顶', 'Top', '10 个'],
        },
        {
          id: 'c2', description: '(1) 说明「比堆顶小才替换并下滤」的关键细节', points: 2,
          evidenceHint: '答案给出替换与调整的条件',
          matchAny: ['堆顶', '替换', '下滤', '筛选'],
        },
        {
          id: 'c3', description: '(2) 时间复杂度 O(n) 及理由（每元素常数次比较）', points: 2,
          evidenceHint: '答案给出 O(n) 与常数比较说明',
          matchAny: ['O(n)', '常数'],
        },
        {
          id: 'c4', description: '(2) 空间复杂度 O(1)（10 元素辅助空间为常数）', points: 2,
          evidenceHint: '答案给出 O(1) 或「与 n 无关」',
          matchAny: ['O(1)', '10 个', '常数'],
        },
      ],
    },
  },
  43: {
    analysis:
      '【原题强依赖单总线数据通路图（MAR/MDR/PC/IR/GPRs/FR/CU 与控制信号），图数据待核对】\n' +
      '已知（题面文字）：FR 存 ALU 标志；控制信号 Read/Write/MDRin/MDRout/PCin/PCout/IRin 等。\n' +
      '(1) 标志位（ZF/CF/OF 等）由 ALU 运算结果置位、写入 FR——分析各指令执行后 FR 的变化。\n' +
      '(2) 暂存器（如 ALU 的输入锁存 Y/Z）存在的必要性：单总线结构下 ALU 两侧输入不能同时来自总线，\n' +
      '需要暂存器锁存一个操作数。\n' +
      '(3) 取指微操作序列：PCout→MARin→Read→MDRin→MDRout→IRin，同时 PC+1；CU 按操作码发出各控制信号。\n' +
      '(4) CU 的输入包括操作码（来自 IR）、标志位（来自 FR）、时钟。\n' +
      '【各子问精确设问与图内信号名以原图为准，待教研核对后细化。】',
    rubric: {
      version: 1,
      totalPoints: 13,
      criteria: [
        {
          id: 'c1', description: '标志位的生成与写入 FR 的通路说明', points: 3,
          evidenceHint: '答案说明 ALU 结果如何置 ZF/CF/OF',
          matchAny: ['FR', '标志', 'ZF', 'CF', 'OF'],
        },
        {
          id: 'c2', description: '暂存器必要性的论证（单总线一次只挂一个操作数）', points: 3,
          evidenceHint: '答案说明 ALU 两输入无法同时取自总线',
          matchAny: ['暂存', '单总线', '锁存'],
        },
        {
          id: 'c3', description: '取指微操作序列完整（PC→MAR→Read→MDR→IR，PC+1）', points: 4,
          evidenceHint: '答案给出完整取指流程与控制信号顺序',
          matchAny: ['PC', 'MAR', 'MDR', 'IR', 'Read'],
        },
        {
          id: 'c4', description: 'CU 的输入来源说明（操作码/标志/时钟）', points: 3,
          evidenceHint: '答案列出 CU 的三类输入',
          matchAny: ['CU', '操作码', '标志', '时钟'],
        },
      ],
    },
  },
  44: {
    analysis:
      '已知：4 双面盘片（8 记录面）、每面 20000 磁道、每道 500 扇区、每扇区 512B、7200rpm、平均寻道 5ms。\n' +
      '(1) 扇区地址三字段 = 柱面（磁道）号 + 盘面（磁头）号 + 扇区号：磁道号 ⌈log2 20000⌉ = 15 位；\n' +
      '盘面号 ⌈log2 8⌉ = 3 位；扇区号 ⌈log2 500⌉ = 9 位。\n' +
      '(2) 平均访问时间 = 平均寻道 5ms + 平均旋转延迟（转半圈 = 60/7200/2 = 4.17ms）+ 传输 512B\n' +
      '（一圈 500 扇区 → 一扇区 = 8.33ms/500 ≈ 16.7μs）≈ 5 + 4.17 + 0.017 ≈ 9.19ms。\n' +
      '(3) 64 位缓冲 = 8B/次 → 512B/8B = 64 次总线请求；CPU 与 DMA 争用主存时，\n' +
      '周期挪用方式下 DMA 优先获得总线（挪用一个存取周期），CPU 暂停一个周期——DMA 可以获得总线使用权。',
    rubric: {
      version: 1,
      totalPoints: 13,
      criteria: [
        {
          id: 'c1', description: '(1) 三字段名称（柱面/盘面/扇区）正确', points: 2,
          evidenceHint: '答案给出 CHS 三字段',
          matchAny: ['柱面', '盘面', '磁头', '扇区'],
        },
        {
          id: 'c2', description: '(1) 各字段位数 15/3/9（或等价），合计 27 位', points: 2,
          evidenceHint: '答案按 20000/8/500 计算位数',
          matchAny: ['15', '3', '9'],
        },
        {
          id: 'c3', description: '(2) 平均访问时间 ≈ 9.2ms（寻道+旋转半圈+传输）', points: 4,
          evidenceHint: '答案给出三段时间及求和',
          matchAny: ['5ms', '4.17', '旋转', '传输'],
        },
        {
          id: 'c4', description: '(3) 总线请求 64 次（512B/8B）', points: 2,
          evidenceHint: '答案给出 64 次',
          matchAny: ['64', '8B', '总线请求'],
        },
        {
          id: 'c5', description: '(3) DMA 优先获得总线（周期挪用），理由正确', points: 3,
          evidenceHint: '答案说明周期挪用下 DMA 优先、CPU 暂停一拍',
          matchAny: ['周期挪用', '优先', '使用权'],
        },
      ],
    },
  },
  45: {
    analysis:
      '已知：块 4KB、目录项=文件名+inode 号、inode 256B（直接 10 + 一二三级间接各 1，每地址项 4B）、\n' +
      '目录 stu（inode 1）→ course（inode 2）→ course1（inode 10）、course2（inode 100）、doc。\n' +
      '(1) 目录文件 stu 的一块可容纳目录项数 = 4096/(目录项大小)；目录项大小未给定时按文件名+4B 估算——\n' +
      '【目录项尺寸/名称字段长度在题 45(b) 图中，待核对】。\n' +
      '(2) doc 的磁盘块号 x：doc inode（编号按图）的直接地址项逐块推算——x 的值按图中 inode 内容核对。\n' +
      '(3) course 内容已在内存，打开 course1 并读入：需读「course1 的 inode 所在块 + course1 的数据块」= 2 块\n' +
      '（inode 号 10 → inode 表位置按 inode 大小推算；数据块按 inode 直接地址）。\n' +
      '(4) course2 增长到 6MB：一块 4KB → 4B 地址项每间接块可存 1024 个地址 → 直接 10×4KB=40KB +\n' +
      '一级 1024×4KB=4MB + 二级 ≥6MB → 需要用到**直接、一级、二级**间接地址项。',
    rubric: {
      version: 1,
      totalPoints: 10,
      criteria: [
        {
          id: 'c1', description: '(1)/(2) 磁盘块号计算正确（按图中 inode 数据）', points: 3,
          evidenceHint: '答案给出块号 x 与推导',
          matchAny: ['块号', 'x', 'inode'],
        },
        {
          id: 'c2', description: '(3) 需读磁盘块数 = 2（inode 块 + 数据块）并说明理由', points: 3,
          evidenceHint: '答案给出 2 块及理由',
          matchAny: ['2', 'inode', '数据块'],
        },
        {
          id: 'c3', description: '(4) 6MB 需用到直接 + 一级 + 二级间接地址项', points: 3,
          evidenceHint: '答案按容量逐级推算',
          matchAny: ['一级', '二级', '间接', '6MB'],
        },
        {
          id: 'c4', description: '各级间接容量计算正确（1024 地址/间接块）', points: 1,
          evidenceHint: '答案给出 1024 或 4KB/4B',
          matchAny: ['1024', '4KB', '4B'],
        },
      ],
    },
  },
  46: {
    analysis:
      'T1 依次执行 A、E、F；T2 依次执行 B、C、D。约束：C 在 A、B 完成后；D、E 在 C 完成后；F 在 E 完成后。\n' +
      '需要两对跨线程同步：①A → C（T1 的 A 完成，T2 才能做 C）：信号量 a2c=0，T1: A; signal(a2c)；T2: wait(a2c); C。\n' +
      '②C → E（T2 的 C 完成，T1 才能做 E）：信号量 c2e=0，T2: C; signal(c2e)；T1: wait(c2e); E; F。\n' +
      '完整序列：T1: A; signal(a2c); wait(c2e); E; F；T2: B; wait(a2c); C; signal(c2e); D。\n' +
      '两个信号量初值均为 0，作用分别是「A→C 的先后约束」与「C→E 的先后约束」。',
    rubric: {
      version: 1,
      totalPoints: 8,
      criteria: [
        {
          id: 'c1', description: '信号量 a2c（A→C）定义、初值 0 正确', points: 2,
          evidenceHint: '答案定义 A 完成后 C 才能执行的信号量',
          matchAny: ['signal', 'wait', 'A', 'C', '0'],
        },
        {
          id: 'c2', description: '信号量 c2e（C→E）定义、初值 0 正确', points: 2,
          evidenceHint: '答案定义 C 完成后 E 才能执行的信号量',
          matchAny: ['C', 'E', '0'],
        },
        {
          id: 'c3', description: 'T1 的序列 A; signal(a2c); wait(c2e); E; F 完整正确', points: 2,
          evidenceHint: '答案给出 T1 的完整 PV 序列',
          matchAny: ['A', 'E', 'F'],
        },
        {
          id: 'c4', description: 'T2 的序列 B; wait(a2c); C; signal(c2e); D 完整正确', points: 2,
          evidenceHint: '答案给出 T2 的完整 PV 序列',
          matchAny: ['B', 'C', 'D'],
        },
      ],
    },
  },
  47: {
    analysis:
      '【原题强依赖拓扑图（H2/H3/H4、设备与路由器 E0 接口），题干问句已抽取，图数据待核对】\n' +
      '已知问句：(1) 设备 1、设备 2 分别选什么设备（集线器/交换机的冲突域判定——\n' +
      'H2 与 H3 之间按最小帧长 64B 争用期约束计算最远距离，设备 2 引入 1.51μs 额外延迟，\n' +
      '若设备 2 是网桥/交换机则分隔冲突域、距离不受争用期限制；若是集线器则同一冲突域）；\n' +
      '(2) H2 与 H3 最远距离：64B 最小帧 → 争用期 = 64×8/10Mbps = 51.2μs → 2×距离/2×10^8 + 1.51μs ≤ 51.2μs\n' +
      '（设备与链路口径按图核对）→ 距离上限约 (51.2−1.51)μs × 2×10^8 m/s ÷ 2 = 4969m（数值待按图核对）。\n' +
      '(3) DHCP：H4 首发报文 M = DHCPDISCOVER（源 0.0.0.0 目的 255.255.255.255 广播）；\n' +
      '路由器 E0 接口能否收到：广播帧在本广播域内传播——E0 是否同域按图核对（DHCP 中继场景可收到）。',
    rubric: {
      version: 1,
      totalPoints: 15,
      criteria: [
        {
          id: 'c1', description: '(1) 设备 1/2 的选型（集线器 vs 交换机/网桥）及冲突域论证', points: 4,
          evidenceHint: '答案区分冲突域边界',
          matchAny: ['集线器', '交换机', '冲突域', '网桥'],
        },
        {
          id: 'c2', description: '(2) 最小帧长与争用期的换算（64B → 51.2μs）', points: 3,
          evidenceHint: '答案给出 64B/51.2μs 推导',
          matchAny: ['64', '51.2', '争用期'],
        },
        {
          id: 'c3', description: '(2) 最远距离计算（扣除设备延迟后 ÷2）', points: 3,
          evidenceHint: '答案给出距离数值与 1.51μs 的处理',
          matchAny: ['1.51', '距离', '2×10'],
        },
        {
          id: 'c4', description: '(3) 报文 M = DHCPDISCOVER（广播）', points: 2,
          evidenceHint: '答案指出 Discover 报文',
          matchAny: ['DISCOVER', '发现', '广播'],
        },
        {
          id: 'c5', description: '(3) 路由器 E0 能否收到的判定及理由（广播域/中继）', points: 3,
          evidenceHint: '答案按图判定广播域边界',
          matchAny: ['E0', '广播', '中继', '收到'],
        },
      ],
    },
  },
};
