const Koa = require('koa')
const router = require('koa-router')()
const path = require("path");
const KoaSSEStream = require('koa-sse-stream')
const child_process = require('child_process')
const bodyParser = require('koa-bodyparser')
const cors = require('@koa/cors')
const moment = require('moment')
const fs = require('fs')
const open = require('opn')
const fetch = require('node-fetch')

/**
 * 执行命令
 * @param {String} script 需要执行的脚本
 * @param {Function} callback 回调函数
 * @returns 
 */
const implementCommand = async (script, callback) => {
    callback({ status: 'building', content: script })
    return new Promise((resolve, reject) => {
        try {
            const sh = child_process.exec(script, (error, stdout, stderr) => {
                // 这里的 stdout stderr 在执行之后才会触发
                if (error) {
                    reject(error);
                    callback({ status: 'error', content: error })
                }
                resolve()
            });
            // 成功的推送
            sh.stdout.on('data', (data) => {
                callback({ status: 'success', content: data })
            })
            // 错误的推送
            sh.stderr.on('data', (error) => {
                callback({ status: 'warning', content: error })
            })
            sh.on('exit', code => {
                console.log('关闭进程', code)
            })
        } catch (error) {
            callback({ status: 'error', content: error })
            reject()
        }
    })
}
/**
 * 打包项目
 * @param {String} projectPath 打包路径
 * @param {String} clone_url 克隆Git项目地址
 * @param {String} name 项目名称
 */
const buildProject = async (projectPath, clone_url, name) => {
    await removeCurrentFile(projectPath, name)
    // 执行 git clone 命令
    await implementCommand(`cd ${projectPath} && git clone --recursive ${clone_url}`, messagePush)
    // 执行 install 命令
    await implementCommand(`cd ${path.join(projectPath, name)} && yarn install`, messagePush)
    // 执行 build 命令
    await implementCommand(`cd ${path.join(projectPath, name)} && npm run build`, messagePush)
    // 打包结束
    messagePush({ status: 'done', content: '打包完成' })
}

/**
* 消息推送
* @param {String}  需要推送的内容
*/
const messagePush = ({ status, content }) => {
    if (status === 'done') {
        clientList.forEach(sse => sse.send({ data: content, event: 'stop' }))
    } else if (status === 'error') {
        clientList.forEach(sse => sse.send({ data: content, event: 'error' }))
    } else if (status === 'warning') {
        clientList.forEach(sse => sse.send({ data: content, event: 'warning' }))
    } else {
        clientList.forEach(sse => sse.send(`[${moment().format('YYYY-MM-DD HH:mm:ss')}] ${content}</br>`))
    }
    // send 自定义事件写法
    // clientList.forEach(sse => sse.send({ data: content, event: 'push' }))
}

const app = new Koa();

app.use(cors())
app.use(bodyParser())

// 链接池
const clientList = []
const SSE_CONF = {
    maxClients: 2,
    pingInterval: 40000
}

router.get('/api/log/push', KoaSSEStream(SSE_CONF), ctx => {
    ctx.res.setHeader('Content-Type', 'text/event-stream')
    ctx.res.setHeader('Cache-Control', 'no-cache')
    // 每次连接会进行一个 push
    clientList.push(ctx.sse);
})

router.get("/", async ctx => {
    ctx.res.setHeader("Content-Type", "text/html;charset=utf-8")
    ctx.body = fs.readFileSync('./public/index.html')
})


router.get('/api/project/list', async ctx => {
    const { user_name } = ctx.query || {}
    const { list = [] } = await fetchGithubUserInfo(user_name)
    ctx.body = {
        code: 200,
        data: {
            user_name,
            list
        }
    }
})

router.post('/api/project/build', ctx => {
    // 接收项目绝对路径
    const { projectPath, clone_url, name } = ctx.request.body;
    try {
        // 先响应
        ctx.body = {
            msg: '开始构建，请留意下方的构建信息。'
        }
        // 再执行构建
        buildProject(projectPath, clone_url, name)
    } catch (error) {
        ctx.body = {
            msg: error
        }
    }
})

const fetchGithubUserInfo = (user_name) => {
    return new Promise(async (resolve, reject) => {
        const response = await fetch(`https://api.github.com/users/${user_name}/repos`)
        const data = await response.json();
        console.log(data, '123')
        if (data.message) {
            resolve({
                list: []
            })
        } else {

            const list = data.map(item => {
                return {
                    name: item.name,
                    full_name: item.full_name,
                    clone_url: item.clone_url,
                    description: item.description,
                    avatar_url: item.owner.avatar_url
                }
            })
            resolve({
                list
            })
        }

    })
}

const removeCurrentFile = (projectPath, name) => {
    const curPath = path.join(projectPath, name)
    return new Promise((resolve, reject) => {
        try {
            if (!fs.existsSync(projectPath)) {
                fs.mkdirSync(projectPath, { recursive: true }, function (err) {
                    resolve(true)
                })
            }
            if (!fs.existsSync(curPath)) {
                resolve(true)
            } else {
                if (fs.statSync(curPath).isDirectory()) { // delete dir
                    fs.rmdirSync(curPath, { recursive: true }, function (err) {
                        if (err) throw err;
                        resolve(true)
                    })
                } else { // delete file
                    console.log(2)
                    fs.unlinkSync(curPath, function (err) {
                        if (err) throw err;
                        resolve(true)
                    });
                }
            }
        } catch (err) {
            console.log('err', err)
            reject(true)
        }
    })
}

app.use(router.routes())
app.listen(3001, () => {
    open('http://localhost:3001')
    console.log('http:localhost:3001 服务启动')
})
