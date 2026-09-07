# 可乐菲出入库系统 — 长期云端版

> 一个真正"装上就不管"的库存管理系统。数据存云端，URL 长期有效，多人共享。

---

## 这是什么？

把"可乐菲出入库明细.html"从单机 localStorage 升级成了**真正的云端数据库版**：

| 维度 | v3.1 单 HTML | v4.0 本版（你正在看的） |
|---|---|---|
| 数据存储 | 浏览器 localStorage（微信/Safari 会清空） | **PostgreSQL 云数据库**（永久） |
| URL 长期有效 | ❌ CloudStudio 沙箱会失效 | ✅ Render 免费层永久 URL |
| 多人共享 | ❌ 各人手机各存各的 | ✅ 同一个链接，所有人实时同步 |
| 注册/登录 | ✅ | ✅（更安全：scrypt 哈希） |
| 入库出库 | ✅ | ✅ |
| 申请审批流 | ✅ | ✅ |
| 数据备份 | 本地下载 JSON | 云端下载 JSON（管理员一键） |
| 适用场景 | 个人单机 | **班级 / 学校 / 多老师协作** |

---

## 一键部署到 Render（最推荐，永久免费）

### 准备工作

1. 一个 **GitHub** 账号（免费注册 https://github.com）
2. 一个 **Render** 账号（用 GitHub 登录 https://render.com ，免费）

### 部署步骤（约 5 分钟）

#### 第 1 步：上传代码到 GitHub

1. 打开 https://github.com/new
2. Repository name 填：`keleifei-inventory`
3. 选 **Public**（公开，Render 免费层要求）
4. **不要**勾选 "Add a README file"
5. 点 **Create repository**
6. 按页面提示在本机执行：
   ```bash
   cd keleifei-server
   git init
   git add .
   git commit -m "Initial deploy"
   git branch -M main
   git remote add origin https://github.com/你的用户名/keleifei-inventory.git
   git push -u origin main
   ```
   （Windows 上没有 git？下载 https://git-scm.com/download/win）

#### 第 2 步：在 Render 创建 Blueprint

1. 登录 https://dashboard.render.com
2. 点右上角 **New +** → **Blueprint**
3. 选择 **Public Git Repository**
4. 粘贴仓库 URL：`https://github.com/你的用户名/keleifei-inventory`
5. 点 **Continue**
6. Render 自动读 `render.yaml`，列出 2 个服务：
   - `keleifei`（Web Service）
   - `keleifei-db`（PostgreSQL）
7. 点 **Apply** → 开始部署
8. 等 2-3 分钟，看到 `keleifei` 状态变成 **Live** 就成功了

#### 第 3 步：拿到你的永久链接

部署完成后，Render 给你的 URL 类似：

```
https://keleifei.onrender.com
```

**这就是你可以永久转发的链接**。直接发给同事微信，他们打开就能用。

> ⚠️ **冷启动说明**：Render 免费层在 15 分钟没人访问时会休眠。下次打开会等 30 秒左右启动。日常使用一直有人访问就不会休眠。如果想要完全无冷启动，升级到 Render Starter 套餐（$7/月）。

---

## 部署到其它平台

### Railway.app（备选，无冷启动）

1. https://railway.app 用 GitHub 登录
2. **New Project** → **Deploy from GitHub repo** → 选你的仓库
3. 自动检测到 Node.js，点 **Deploy**
4. 等部署完，点 **Variables** → 添加：
   - `NODE_ENV` = `production`
5. **Add Plugin** → **PostgreSQL** → 自动注入 `DATABASE_URL`
6. **Settings** → **Generate Domain** → 拿到 URL

### fly.io（备选，免费层不冷启动 + 3GB 持久卷）

1. 安装 flyctl：https://fly.io/docs/hands-on/install-flyctl/
2. ```bash
   cd keleifei-server
   fly launch          # 创建一个 app（跟着提示选 region）
   fly volumes create data --size 1  # 1GB 持久卷（SQLite 模式）
   fly deploy
   fly open
   ```
   注意：fly.io 模式下需要把 `server.js` 里的数据库适配改成 SQLite + 持久卷路径。简单办法是用 Railway 替代。

---

## 部署到本机（局域网 / 自己电脑）

最简单的方式，整个班级共用一台小电脑就行：

```bash
cd keleifei-server
npm install
node server.js
```

会看到：
```
=====================================
  可乐菲出入库系统 已启动（长期版）
  数据库: SQLITE
  监听端口: 3000
  本机访问: http://localhost:3000
=====================================
```

班上的其他老师用同一 WiFi，手机浏览器打开 `http://你的电脑IP:3000` 就能用。

**找 IP**：
- Windows：`ipconfig` 看 IPv4 地址（一般是 192.168.x.x）
- Mac：`ifconfig | grep "inet "`

**长期开机**：把命令放进开机启动 / 计划任务，意外重启后自动跑起来。

---

## 首次使用

部署完成后第一次打开链接：

1. 看到"系统初始化"页面
2. 创建第一个管理员账号（建议填"小雪老师" + 密码）
3. 自动登录，进入系统

### 初始化数据

第一次部署后数据库是空的。两种方式灌入初始数据：

**方式 A：从 Excel 导入**（推荐，先在本地 v3.1 灌好后导出 JSON）

1. 在本地用 `可乐菲出入库明细.html`（v3.1）灌好你的物品和流水
2. 点 "设置 → 📦 备份与恢复 → 📥 导出全部数据" 拿到 JSON
3. 登录管理员账号
4. 进入"设置 → 备份与恢复"
5. 选 JSON 文件上传 → 恢复完成

**方式 B：管理员手动添加物品和入库**

进入"物品建档"和"入库登记"，手动添加。

### 给其他老师开账号

1. 同事用链接打开后点"📝 还没账号？点这里自助注册"
2. 注册后默认是普通用户
3. 管理员在"用户管理"里把他们提权为"授权人员"（可入库）或保留"普通用户"（只能看自己的）

---

## 数据安全

- ✅ **PostgreSQL 数据库**存 Render 云端，与服务实例独立，不会因为重启/重部署丢数据
- ✅ **密码用 scrypt 哈希**（不是明文，业内标准）
- ✅ **Token 存数据库**，登出/改密码自动失效
- ✅ **每周建议**：管理员在"设置"里点"📥 备份到本地"，把 JSON 存到自己电脑一份

---

## 项目结构

```
keleifei-server/
├── server.js            # 后端主程序（Express + 数据库适配）
├── package.json         # npm 依赖
├── render.yaml          # Render 一键部署配置
├── README.md            # 本文件
├── .gitignore
└── public/
    └── index.html       # 前端（单文件，跟后端在一起）
```

---

## 常见问题

**Q: Render 免费层会不会突然关停？**
A: Render 官方承诺免费层一直可用，但免费 PostgreSQL 90 天后会进入休眠（数据保留）。要长期可用，每年登录一次点 "Wake up" 即可，或者升级到付费层（$7/月免维护）。

**Q: 数据会丢吗？**
A: 不会。PostgreSQL 数据独立于 Web 服务，重启/重新部署都不会丢。建议每周下载一份 JSON 备份到本地。

**Q: 链接被别人猜到了怎么办？**
A: Render 公开 URL 谁都能打开。靠账号密码保护。管理员定期改密码即可。如果想要私密访问，Render 提供 IP 白名单/密码保护（付费）。

**Q: 我不想用 Render，能用国内的吗？**
A: 可以。腾讯云"轻量应用服务器"（24元/月起）或阿里云"函数计算"。需要的话我帮你写部署脚本。

**Q: 微信浏览器能打开吗？**
A: 能。Render 链接是 https，微信不会拦。但首次访问可能弹"非微信官方域名"提示，点"继续访问"即可。

---

## License

MIT