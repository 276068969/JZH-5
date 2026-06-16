# 候鸟迁徙监管平台

候鸟迁徙监管平台是一个包含前台监测台、后台管理台和后端接口的全栈演示系统，可通过 Docker 一键部署。系统围绕迁飞路线、监测站点、告警事件、现场观测记录和监管通知进行管理。

## 核心特点

- 前台监测台：展示迁徙路线态势、今日过境数量、站点状态、告警事件和观测记录。
- 后台管理台：支持告警处置、设备巡检查看和监管通知发布。
- 账号权限：内置管理员、巡护员、访客三类测试账号。
- 数据持久化：默认使用 JSON 文件保存演示数据，Docker 部署时挂载到本地 `data` 目录。
- 轻量部署：无外部数据库依赖，适合课程设计、原型演示和离线环境运行。

## 技术选型

- 前端：HTML5、CSS3、原生 JavaScript
- 后端：Node.js HTTP Server
- 数据存储：JSON 文件
- 部署：Docker、Docker Compose

## 测试账号

| 角色 | 用户名 | 密码 | 说明 |
| --- | --- | --- | --- |
| 管理员 | `admin` | `Admin@2026` | 可进入后台、处置告警、发布监管通知 |
| 巡护员 | `ranger` | `Ranger@2026` | 可提交观测记录、处置告警、查看站点 |
| 访客 | `viewer` | `Viewer@2026` | 可查看前台监测数据 |

## 本地运行

```bash
npm start
```

访问：

- 前台监测台：http://localhost:3000
- 后台管理台：http://localhost:3000/admin.html

## Docker 部署

```bash
docker compose up -d --build
```

停止服务：

```bash
docker compose down
```

容器启动后访问：http://localhost:3000

## 项目结构

```text
.
├── backend
│   ├── data
│   │   └── seed.json
│   └── src
│       ├── server.js
│       └── store.js
├── frontend
│   ├── admin.html
│   ├── index.html
│   └── assets
│       ├── admin.js
│       ├── app.js
│       └── styles.css
├── Dockerfile
├── docker-compose.yml
├── package.json
└── README.md
```
