/**
 * hint-policy 单元测试。运行：node --test extension/hint-policy.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    isModelGeneration,
    decideHint,
    shouldShowSettingsNotice,
    extractRawFinishReason,
    detectPassthrough,
    messageHasPassthroughField,
    isRawPresent,
} from './hint-policy.js';
import { classify, fallback } from './compat-contract.js';

function greeting(overrides = {}) {
    return {
        name: 'Seraphina',
        is_user: false,
        is_system: false,
        send_date: '2026-11-12T08:20:56.486Z',
        mes: '你好，我是角色开场白。',
        extra: {},
        swipes: ['你好，我是角色开场白。'],
        swipe_id: 0,
        swipe_info: [{ send_date: '2026-11-12T08:20:56.486Z', extra: {} }],
        ...overrides,
    };
}

function generated(overrides = {}) {
    const { extra: extraOverride, ...rest } = overrides;
    return {
        name: 'Seraphina',
        is_user: false,
        is_system: false,
        send_date: '2026-11-12T08:23:24.239Z',
        mes: '你好啊。',
        gen_started: '2026-11-12T08:23:22.260Z',
        gen_finished: '2026-11-12T08:23:24.239Z',
        extra: {
            api: 'openrouter',
            model: 'google/gemini-3.8-flash',
            ...extraOverride,
        },
        swipe_id: 0,
        ...rest,
    };
}

describe('isModelGeneration', () => {
    it('greeting / first_message / empty extra is not a generation', () => {
        const mes = greeting();
        assert.equal(isModelGeneration(mes), false);
        assert.equal(isModelGeneration(mes, 'first_message'), false);
        assert.equal(decideHint({ message: mes, raw: null, passthroughAvailable: true }).askClassify, false);
        assert.equal(decideHint({ message: mes, eventType: 'first_message', raw: null, passthroughAvailable: true }).reason, 'not_generation');
    });

    it('greeting with leftover extra.duanyin is still not a generation and gets no unknown hint', () => {
        const mes = greeting({
            extra: { duanyin: { raw: 'length', dismissed: true } },
        });
        assert.equal(isModelGeneration(mes), false);
        assert.equal(isModelGeneration(mes, 'first_message'), false);
        const decision = decideHint({
            message: mes,
            raw: mes.extra.duanyin.raw,
            passthroughAvailable: true,
        });
        assert.equal(decision.askClassify, false);
        assert.equal(decision.allowUnknown, false);
        assert.equal(decision.reason, 'not_generation');
        assert.equal(messageHasPassthroughField(mes), false);
    });

    it('first_message event type wins over confusing generation-like fields', () => {
        const mes = generated({ extra: { api: 'openrouter', model: 'x', finish_reason: 'stop' } });
        assert.equal(isModelGeneration(mes), true);
        assert.equal(isModelGeneration(mes, 'first_message'), false);
        const decision = decideHint({
            message: mes,
            eventType: 'first_message',
            raw: 'stop',
            passthroughAvailable: true,
        });
        assert.equal(decision.askClassify, false);
        assert.equal(decision.reason, 'not_generation');
    });

    it('quiet events are never treated as a user-facing generation', () => {
        const mes = generated({ extra: { finish_reason: 'stop' } });
        assert.equal(isModelGeneration(mes, 'quiet'), false);
        assert.equal(decideHint({ message: mes, eventType: 'quiet', raw: 'stop' }).reason, 'quiet');
    });

    it('user and system messages are not generations', () => {
        assert.equal(isModelGeneration({ is_user: true, mes: 'hi', gen_started: '2026-11-12T00:00:00.000Z' }), false);
        assert.equal(isModelGeneration({ is_system: true, is_user: false, mes: 'sys' }), false);
        assert.equal(isModelGeneration(null), false);
        assert.equal(isModelGeneration(undefined), false);
    });

    it('live-shaped generated message with gen_started, api/model, and finish_reason is a generation', () => {
        const stop = generated({ extra: { finish_reason: 'stop' } });
        const length = generated({ extra: { finish_reason: 'length' } });
        assert.equal(isModelGeneration(stop), true);
        assert.equal(isModelGeneration(length), true);
        const decision = decideHint({
            message: stop,
            raw: 'stop',
            passthroughAvailable: true,
        });
        assert.equal(decision.askClassify, true);
        assert.equal(decision.allowUnknown, true);
    });

    it('swipe_info gen_started on the current swipe is generation evidence', () => {
        const mes = greeting({
            extra: {},
            swipe_info: [{ send_date: '2026-11-12T08:23:22.260Z', gen_started: '2026-11-12T08:23:22.260Z', gen_finished: '2026-11-12T08:23:24.239Z', extra: {} }],
        });
        assert.equal(isModelGeneration(mes), true);
    });
});

describe('decideHint', () => {
    it('unpatched generation with no raw: no per-message unknown, settings notice yes', () => {
        const mes = generated(); // gen_started + api/model, no finish_reason
        assert.equal(isModelGeneration(mes), true);
        const decision = decideHint({
            message: mes,
            raw: null,
            passthroughAvailable: false,
        });
        assert.equal(decision.askClassify, true);
        assert.equal(decision.allowUnknown, false);
        assert.equal(decision.reason, 'passthrough_unavailable');
        assert.equal(shouldShowSettingsNotice(false), true);
        assert.equal(shouldShowSettingsNotice(true), false);
    });

    it('patched generation with raw null allows the unknown fallback (case C)', () => {
        const mes = generated();
        const decision = decideHint({
            message: mes,
            raw: null,
            passthroughAvailable: true,
        });
        assert.equal(decision.askClassify, true);
        assert.equal(decision.allowUnknown, true);
        assert.equal(decision.reason, 'patched_unknown');
        const info = classify(null, { message: mes });
        assert.equal(info.category, 'unknown');
        assert.equal(info.show, true);
        assert.equal(info.title, fallback.title_zh);
    });

    it('raw present is still classified even if passthrough is unavailable', () => {
        const mes = generated({ extra: { finish_reason: 'length' } });
        const decision = decideHint({
            message: mes,
            raw: 'length',
            passthroughAvailable: false,
        });
        assert.equal(decision.askClassify, true);
        assert.equal(decision.allowUnknown, true);
        assert.equal(decision.reason, 'raw_present');
        const info = classify('length');
        assert.equal(info.category, 'truncated');
        assert.equal(info.show, true);
    });

    it('literal raw "unknown" is allowed through classify', () => {
        const mes = generated({ extra: { finish_reason: 'unknown' } });
        const decision = decideHint({
            message: mes,
            raw: 'unknown',
            passthroughAvailable: false,
        });
        assert.equal(decision.askClassify, true);
        assert.equal(decision.allowUnknown, true);
        assert.equal(classify('unknown').category, 'unknown');
    });
});

describe('extractRawFinishReason', () => {
    it('reads finish_reason from the same message only', () => {
        const mes = generated({ extra: { finish_reason: 'stop' } });
        assert.deepEqual(extractRawFinishReason({ message: mes, mesId: 3 }), {
            raw: 'stop',
            key: 'finish_reason',
        });
    });

    it('does not leak finish_reason from a different chat message', () => {
        const greetingMes = greeting();
        const other = generated({ extra: { finish_reason: 'length' } });
        assert.equal(extractRawFinishReason({ message: greetingMes, mesId: 0 }), null);
        assert.equal(extractRawFinishReason({
            message: greetingMes,
            eventData: other,
            mesId: 0,
        }), null);
        assert.equal(extractRawFinishReason({
            message: greetingMes,
            eventData: { mesId: 4, finish_reason: 'content_filter' },
            mesId: 0,
        }), null);
    });

    it('uses eventData when the event is about the same message', () => {
        const mes = generated();
        assert.deepEqual(extractRawFinishReason({
            message: mes,
            eventData: { finish_reason: 'MAX_TOKENS' },
            mesId: 3,
        }), { raw: 'MAX_TOKENS', key: 'finish_reason' });
    });
});

describe('detectPassthrough', () => {
    it('is true only when both patch exports exist', async () => {
        assert.equal(await detectPassthrough({
            importOpenai: async () => ({
                extractFinishState: () => {},
                applyFinishStateToExtra: () => {},
            }),
        }), true);
        assert.equal(await detectPassthrough({
            importOpenai: async () => ({ extractFinishState: () => {} }),
        }), false);
        assert.equal(await detectPassthrough({
            importOpenai: async () => ({}),
        }), false);
        assert.equal(await detectPassthrough({
            importOpenai: async () => { throw new Error('failed to fetch'); },
        }), false);
    });
});

describe('classify smoke (contract unchanged)', () => {
    it('keeps classify(null) as the unknown fallback', () => {
        const info = classify(null);
        assert.equal(info.category, 'unknown');
        assert.equal(info.show, true);
        assert.equal(info.action, 'continue');
    });

    it('still maps stop / missing aliases', () => {
        assert.equal(classify('stop').show, false);
        assert.equal(classify('missing').category, 'unknown');
        assert.equal(classify('FINISH_REASON_UNSPECIFIED').category, 'unknown');
        assert.equal(isRawPresent(null), false);
        assert.equal(isRawPresent('  '), false);
        assert.equal(isRawPresent('unknown'), true);
    });
});
