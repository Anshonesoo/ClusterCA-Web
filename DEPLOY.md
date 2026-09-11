# ClusterCA Web V2 部署说明

ClusterCA 是纯前端应用，不需要数据库或常驻后端。生产产物位于 `dist`，但必须通过 HTTP(S) 提供，不能直接双击 `dist/index.html`，因为 Web Worker 和模块脚本受浏览器安全策略限制。

## 本地生产模式

1. 已附带 `dist` 时，双击 `serve.cmd`。
2. 浏览器访问 `http://127.0.0.1:4173/`。
3. 关闭服务器窗口或按 `Ctrl+C` 停止。

也可以运行：

```powershell
node scripts/serve-dist.mjs
```

设置环境变量 `CLUSTERCA_PORT` 可更改端口。

## 从源代码构建

需要 Node.js 20 或更新版本，以及 pnpm：

```powershell
pnpm install
pnpm test
pnpm build
```

构建成功后将整个 `dist` 目录上传到任意静态网站服务。构建使用相对资源路径，可以部署在域名根目录或子目录。

## 常见静态托管

- GitHub Pages：将 `dist` 内容发布到 Pages 分支或由 Actions 上传为 Pages artifact。
- Cloudflare Pages、Netlify、Vercel：构建命令使用 `pnpm build`，输出目录填写 `dist`。
- 普通 Nginx/Apache：把 `dist` 复制到站点目录；无需 API 反向代理。

部署后至少检查：页面可打开、Worker 能执行单步、开发者模板第 2 Tick 生成休眠种子、保存项目能下载 `.clusterca` 文件。
