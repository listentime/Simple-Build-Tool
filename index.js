const Koa = require( 'koa' )
const router = require( 'koa-router' )()
const path = require( "path" );
const KoaSSEStream = require( 'koa-sse-stream' )
const child_process = require( 'child_process' )
const bodyParser = require( 'koa-bodyparser' )
const cors = require( '@koa/cors' )
const moment = require( 'moment' )
const fs = require( 'fs' )
/**
 * 执行命令
 * @param {String} script 需要执行的脚本
 * @param {Function} callback 回调函数
 * @returns 
 */
const implementCommand = async ( script, callback ) => {
    callback( { status: 'building', content: script } )
    return new Promise( ( resolve, reject ) => {
        try {
            const sh = child_process.exec( script, ( error, stdout, stderr ) => {
                // 这里的 stdout stderr 在执行之后才会触发
                if ( error ) {
                    reject( error );
                    callback( { status: 'error', content: error } )
                }
                resolve()
            } );
            // 成功的推送
            sh.stdout.on( 'data', ( data ) => {
                callback( { status: 'success', content: data } )
            } )
            // 错误的推送
            sh.stderr.on( 'data', ( error ) => {
                callback( { status: 'warning', content: error } )
            } )
        } catch ( error ) {
            callback( { status: 'error', content: error } )
            reject()
        }
    } )
}
/**
 * 打包项目
 * @param {String} projectPath 打包路径
 */
const buildProject = async projectPath => {
    // 执行 install 命令
    await implementCommand( `cd ${ projectPath } && yarn install`, messagePush )
    // 执行 build 命令
    await implementCommand( `cd ${ projectPath } && npm run build`, messagePush )
    // 打包结束
    messagePush( { status: 'done', content: '打包完成' } )
}

/**
* 消息推送
* @param {String}  需要推送的内容
*/
const messagePush = ( { status, content } ) => {
    if ( status === 'done' ) {
        clientList.forEach( sse => sse.send( { data: content, event: 'stop' } ) )
    } else if ( status === 'error' ) {
        clientList.forEach( sse => sse.send( { data: content, event: 'error' } ) )
    } else if ( status === 'warning' ) {
        clientList.forEach( sse => sse.send( { data: content, event: 'warning' } ) )
    } else {
        clientList.forEach( sse => sse.send( `[${ moment().format( 'YYYY-MM-DD HH:mm:ss' ) }] ${ content }</br>` ) )
    }
    // send 自定义事件写法
    // clientList.forEach(sse => sse.send({ data: content, event: 'push' }))
}

const app = new Koa();

app.use( cors() )
app.use( bodyParser() )

// 链接池
const clientList = []
const SSE_CONF = {
    maxClients: 2,
    pingInterval: 40000
}

router.get( '/api/log/push', KoaSSEStream( SSE_CONF ), ctx => {
    ctx.res.setHeader( 'Content-Type', 'text/event-stream' )
    ctx.res.setHeader( 'Cache-Control', 'no-cache' )
    // 每次连接会进行一个 push
    clientList.push( ctx.sse );
} )

router.get( "/", async ctx => {
    ctx.res.setHeader( "Content-Type", "text/html;charset=utf-8" )
    ctx.body = fs.readFileSync( './public/index.html' )
} )



router.post( '/api/project/build', ctx => {
    // 接收项目绝对路径
    const { projectPath } = ctx.request.body;
    try {
        // 先响应
        ctx.body = {
            msg: '开始构建，请留意下方的构建信息。'
        }
        // 再执行构建
        buildProject( projectPath )
    } catch ( error ) {
        ctx.body = {
            msg: error
        }
    }
} )

app.use( router.routes() )
app.listen( 3000, () => {
    console.log( 'http:localhost:3000 服务启动' )
} )