// 设置页的「推送订阅状态」面板。
//
// 主动消息 2.0 最难自己发现的故障是「静默失联」：任务建得成、界面全绿、到点一条
// 消息都不来。原因通常在推送这条链路上——权限没给、订阅被浏览器吊销、或者 worker
// 上登记的订阅根本不是这台设备。这个面板把这条链路从头到尾摊开，最后一行「云端
// 登记」正是拆穿静默失联的那一行。
//
// 只读诊断走 pushSubscribeShared 的 readBrowserPushState（各推送层共用同一份判定），
// 重置走 ActiveMsgClient 的 amsg2 路径——退订、按 worker 自己的 VAPID 重订、再覆盖
// 登记回 worker。三步缺一不可，少了最后一步就是把这个面板要治的病再犯一遍。

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActiveMsgClient,
  compareRemotePushSubscription,
  fetchWorkerDiagnostics,
  readAmsgFailKind,
  type AmsgPushRegistrationState,
  type AmsgRemotePushSubscription,
} from '../../utils/activeMsgClient';
import {
  judgePushDeliveryFailure,
  type AmsgPushDeliveryProbe,
} from '../../utils/amsgDiagnostics';
import { catchUpMissedPushesManually } from '../../utils/activeMsgRuntime';
import { readBrowserPushState, type BrowserPushState } from '../../utils/pushSubscribeShared';
import {
  describeElapsed,
  describePermission,
  describeServiceWorker,
  describeSubscription,
  describeSupport,
  hasLiveFailure,
  isSupportBad,
  liveFailureKind,
} from '../../utils/pushDiagnosticsView';
import { bucketRetryCount, trackEvent } from '../../utils/analytics';
import { Group, Notice, Row as SettingsRow, resultSub } from './SettingsParts'; // [EM: settings-subpages-f]

interface PushSubscriptionPanelProps {
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

/** 连续几次僵尸失败之后，「重置订阅」升级成「深度重置」。 */
const DEEP_RESET_THRESHOLD = 3;



const REGISTRATION_TEXT: Record<AmsgPushRegistrationState, { value: string; bad: boolean }> = {
  'worker-unset': { value: '还没填 Worker 地址', bad: true },
  unreachable: { value: '问不到（Worker 连不上，或版本太旧没这个接口）', bad: true },
  missing: { value: '没有登记', bad: true },
  'other-endpoint': { value: '登记的是别的设备', bad: true },
  matched: { value: '已登记（就是这台设备）', bad: false },
};

const PushSubscriptionPanel: React.FC<PushSubscriptionPanelProps> = ({ addToast }) => {
  const [browser, setBrowser] = useState<BrowserPushState | null>(null);
  const [remote, setRemote] = useState<AmsgRemotePushSubscription | null>(null);
  // 「登记的确实是这台设备，但推送根本送不到」——只有 Worker 那侧的投递结果知道这件事。
  // null = 还没问到（没填 Worker / 连不上），那时这一行照实说「没查到」。
  const [delivery, setDelivery] = useState<AmsgPushDeliveryProbe | null>(null);
  const [workerConfigured, setWorkerConfigured] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [catchingUp, setCatchingUp] = useState(false);
  // 连续几次僵尸失败。不落盘：刷新页面就归零，用户不会莫名其妙看到一个红按钮。
  const [zombieStreak, setZombieStreak] = useState(0);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const browserState = await readBrowserPushState();
      setBrowser(browserState);
      // 没填 Worker 地址就别去问了——问也是白问，还会在控制台留一串没用的报错。
      const config = await ActiveMsgClient.getGlobalConfig().catch(() => null);
      const configured = Boolean(config?.workerUrl?.trim());
      setWorkerConfigured(configured);
      setRemote(configured ? await ActiveMsgClient.getRemotePushSubscription() : null);
      // 「推送有没有真的送出去」是 Worker 那侧算好的（见 /debug 的 pushDelivery）。
      // 这一行和体检面板读的是同一份，不会一个说红一个说绿。
      const probe = configured ? await fetchWorkerDiagnostics() : null;
      setDelivery(probe?.reachable ? probe.report.storage.pushDelivery ?? null : null);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const deepMode = zombieStreak >= DEEP_RESET_THRESHOLD;

  const handleReset = async () => {
    if (resetting) return;
    setResetting(true);
    try {
      if (deepMode) {
        await ActiveMsgClient.deepResetPushSubscription();
      } else {
        await ActiveMsgClient.resetPushSubscription();
      }
      setZombieStreak(0);
      addToast('订阅已重建，并登记到了 Worker 上。', 'success');
      // 只报「成不成 / 是哪一档 / 之前失败了几次」，全是源码里写死的枚举。
      trackEvent(deepMode ? '深度重置推送订阅' : '重置推送订阅', {
        result: 'success',
        attempt: bucketRetryCount(zombieStreak),
      });
    } catch (error: any) {
      const failKind = readAmsgFailKind(error);
      // 僵尸端点是「重试也没用」的那一类，攒够次数把按钮升级成深度重置。
      // 别的失败（没配 VAPID、权限被拒、断网）换深度重置一点用没有，不计数。
      if (failKind === '端点僵尸') setZombieStreak((count) => count + 1);
      // 报错原文可能带 push endpoint，只留在 toast 和控制台里，不进上报。
      addToast(error?.message || '重置订阅失败。', 'error');
      trackEvent(deepMode ? '深度重置推送订阅' : '重置推送订阅', {
        result: failKind,
        attempt: bucketRetryCount(zombieStreak),
      });
    } finally {
      setResetting(false);
      await refresh();
    }
  };

  /**
   * 手动补收：去云端账本上把没收到的消息捞回来。
   *
   * 结果照实说，不含糊：捞回来几条、翻过多少条都报出来。「一条都没补回来」跟「压根没读成」
   * 是两个结论，用户拿它决定下一步该干嘛（前者说明消息不在账本上、该查别处，后者只是这趟
   * 没读成、再点一次就行），混在一起说等于什么都没说。
   */
  const handleCatchUp = async () => {
    setCatchingUp(true);
    try {
      const { written, scanned, stale } = await catchUpMissedPushesManually();
      if (written > 0) {
        // 补回来了，但同一趟里还有超窗的——两件事都得说，不然用户以为全找回来了。
        addToast(
          stale > 0
            ? `补回 ${written} 条消息，去聊天里看看。另有 ${stale} 条超过两天，拿不回来了。`
            : `补回 ${written} 条消息，去聊天里看看。`,
          'success',
        );
      } else if (stale > 0) {
        // 有本该收到的消息、但全都过了两天：说清楚是「丢了」不是「没有」——这是用户
        // 唯一一次知道这件事的机会，含糊过去他会以为链路是好的。
        addToast(`有 ${stale} 条消息超过两天没能收到，已经拿不回来了。`, 'error');
      } else if (scanned > 0) {
        // 账本上有行，但没一条是该上屏的聊天内容（思维链、工具请求这些不进聊天流）。
        addToast('账本上剩下的都不是聊天内容，没有可补的消息。', 'info');
      } else {
        addToast('账本上没有漏收的消息——这条链路是通的。', 'info');
      }
    } catch (error: any) {
      addToast(error?.message || '读云端账本失败，待会儿再试。', 'error');
    } finally {
      setCatchingUp(false);
    }
  };

  const registration: AmsgPushRegistrationState = workerConfigured
    ? compareRemotePushSubscription(browser?.endpoint, remote)
    : 'worker-unset';
  const registrationText = REGISTRATION_TEXT[registration];

  // 上一次推送到底送没送到。判定跟体检面板共用 judgePushDeliveryFailure——两处各写一套的话，
  // 用户会看到一个红一个绿，而这正是他判断该不该重置订阅的唯一依据。
  const deliveryVerdict = judgePushDeliveryFailure(delivery);
  const deliveryText: { value: string; bad: boolean } = !workerConfigured || !delivery
    ? { value: '没查到（要先连上 Worker）', bad: false }
    : !delivery.probed
      ? { value: delivery.reason === 'unsupported' ? '这台 Worker 还不查' : '没查成', bad: false }
      : delivery.gone && deliveryVerdict
        ? { value: `被推送服务退回（${delivery.gone.status}）`, bad: true }
        // 有旧账但已经不算数了：说清楚「那是上一条订阅的事」，别让人以为从来没坏过。
        : { value: delivery.gone ? '这条订阅登记之后没被退回过' : '没有被退回的记录', bad: false };

  const resetLabel = resetting
    ? (deepMode ? '深度重置中…' : '重置中…')
    : (deepMode ? '深度重置' : '重置订阅');

  // [EM-START: settings-subpages-f] 换成设置子页的分组列表：链路每一环一行，坏了的那行红字；出事的说明用 Notice
  const refreshNow = () => {
    trackEvent('刷新 Web Push 诊断', browser ? {
      permission: browser.permission,
      subscription: !browser.endpoint ? 'none' : browser.endpointDead ? 'dead' : 'active',
      swState: browser.swState === 'activated' ? 'activated' : browser.swState === 'none' ? 'none' : 'other',
      platform: browser.capacitorNative ? 'capacitor_native' : browser.iosNeedsPwa ? 'ios_needs_pwa' : 'normal',
      registration,
      lastFailure: liveFailureKind(browser) ?? 'none',
      delivery: !delivery || !delivery.probed ? 'unknown'
        : delivery.gone && deliveryVerdict ? 'gone'
          : delivery.gone ? 'recovered' : 'clean',
    } : undefined);
    void refresh();
  };
  // 短的状态写在右边；长的（带括号解释的）写到标题下面，不然右边一截被截断
  const line = (title: string, value: string, bad?: boolean) => value.length > 10
    ? <SettingsRow key={title} title={title} dot={bad ? 'bad' : null} sub={bad ? resultSub({ tone: 'bad', text: value }) : value} />
    : <SettingsRow key={title} title={title} value={value} valueTone={bad ? 'bad' : 'plain'} dot={bad ? 'bad' : null} />;
  const failure = browser && hasLiveFailure(browser) ? browser.lastSubscribeFailure : null;

  return (
    <>
      <Group title="推送链路" foot="主动消息到点靠网页推送送到你手上。任何一环断了，表现都是「任务建得成、到点没消息」，界面上看不出来，所以每一环都摊开在这里。">
        {browser ? (
          <>
            {line('浏览器支持', describeSupport(browser), isSupportBad(browser))}
            {line('通知权限', describePermission(browser.permission), browser.permission !== 'granted')}
            {line('Service Worker', describeServiceWorker(browser), browser.swState !== 'activated')}
            {line('浏览器订阅', describeSubscription(browser), !browser.endpoint || browser.endpointDead)}
            {line('推送通道', browser.channel)}
            {line('云端登记', registrationText.value, registrationText.bad)}
            {line('上次投递', deliveryText.value, deliveryText.bad)}
            {browser.endpoint && <SettingsRow title="订阅端点" sub={<span style={{ fontFamily: 'ui-monospace, Menlo, monospace', wordBreak: 'break-all' }}>{browser.endpoint.slice(0, 60)}…</span>} />}
          </>
        ) : <SettingsRow title="读取中…" />}
        <SettingsRow title={refreshing ? '读取中…' : '刷新'} tone="link" disabled={refreshing || resetting} onClick={refreshNow} />
      </Group>

      {browser?.capabilityGap && <Notice tone="warning">{browser.capabilityGap}。</Notice>}
      {failure && (
        <Notice tone="danger" title={`上次建订阅失败${describeElapsed(failure.at) ? `（${describeElapsed(failure.at)}）` : ''}`}>
          {failure.text}。
          {(failure.kind === 'channel-unreachable' || failure.kind === 'no-subscription') && (
            <> 这一类重试多少次都一样，问题不在这个站点也不在权限：换个浏览器、换个网络或换台设备才有用。</>
          )}
        </Notice>
      )}
      {browser?.endpointDead && (
        <Notice tone="danger" title="订阅被浏览器吊销了">
          地址变成了 permanently-removed.invalid（很久没打开、通知权限改过、站点数据清过都会这样），推过去必然失败。点下面「重置订阅」重建一条。
        </Notice>
      )}
      {deliveryVerdict?.level === 'bad' && (
        <Notice tone="danger" title="推送被退回了">
          {deliveryVerdict.what}。上面每一行都没问题，坏的是这条订阅本身——它在推送服务（Chrome 走 FCM、Firefox 走 Mozilla、iOS 走 Apple）那边已经作废，只有推送服务知道。点「重置订阅」换一条新的。
        </Notice>
      )}
      {registration === 'other-endpoint' && (
        <Notice tone="danger" title="云端登记的不是这台设备">
          到点会推到别处。换过设备、浏览器或 Worker 后会这样（一个账号只存一份订阅，后登记的顶掉先前的）。点「重置订阅」改成这台。
        </Notice>
      )}
      {registration === 'missing' && browser && !isSupportBad(browser) && (
        <Notice tone="danger">Worker 上一份订阅都没有，到点没地方推。点「重置订阅」登记这台设备。</Notice>
      )}
      {browser?.iosNeedsPwa && (
        <Notice tone="warning">现在不是从主屏图标打开的。iOS 的网页推送要先「添加到主屏幕」，再从主屏图标打开才能用。</Notice>
      )}
      {browser?.capacitorNative && (
        <Notice tone="info">你现在用的是打包好的 App，网页推送这条通道在 App 里不存在，这一页可以忽略，不影响正常使用。</Notice>
      )}

      <Group foot={<>「重置订阅」清掉现在这条、重建一条，再登记到 Worker 上；换了浏览器、换了 Worker、订阅被吊销之后点它。{deepMode && ' 连着几次都没成，已经切到「深度重置」：会把 Service Worker 整个重装一遍。'}{workerConfigured && !browser?.capacitorNative && ' 「找回没收到的消息」：每条消息发出前云端都先记一行，你这边收到才销账，推送在路上丢了内容还在云端，点它捞回最近两天漏掉的。'}</>}>
        <SettingsRow title={resetLabel} tone={deepMode || browser?.endpointDead || registrationText.bad || deliveryText.bad ? 'danger' : 'link'}
          disabled={resetting || refreshing || browser?.capacitorNative} onClick={() => void handleReset()} />
        {workerConfigured && !browser?.capacitorNative && (
          <SettingsRow title={catchingUp ? '正在找…' : '找回没收到的消息'} tone="link" disabled={catchingUp || resetting || refreshing} onClick={() => void handleCatchUp()} />
        )}
      </Group>
    </>
  );
  // [EM-END: settings-subpages-f]
};

export default PushSubscriptionPanel;
