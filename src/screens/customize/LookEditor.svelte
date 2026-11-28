<script lang="ts">
  /**
   * 호봉이 꾸미기(#17·#16) 고르는 칸. 저장하지 않고 고른 값(look)만 바꾼다 — 저장은 감싼 쪽이 한다
   * (설정의 '호봉이 꾸미기' 창, 나중에 첫 입력의 '호봉이 고르기' 단계).
   *
   * - 견본은 모두 진짜 라디오(input type=radio)다: 묶음마다 Tab 정지점 하나, 방향키로 고른다.
   *   색만으로 구별하지 않게 견본 밑에 이름 글자를 두고, 고른 견본은 두꺼운 테두리와 ✓ 표시를 함께 쓴다.
   * - 이 버전이 모르는 id(새 버전에서 고른 장식 등)는 고르지 않은 칸으로 두고, 다른 것을 고르기 전까지 그대로 둔다.
   */
  import { onMount, untrack } from 'svelte';
  import { josa } from '../../lib/app/format.ts';
  import {
    lookChangeText,
    lookName,
    paintShownFrom,
    plumeClashes,
    plumeName,
    randomLook,
  } from '../../lib/character/customize.ts';
  import {
    resolveCustom,
    resolveLook,
    resolveProp,
    trackPropOf,
    type Look,
    type MoodId,
    type PropOwner,
  } from '../../lib/character/look.ts';
  import { characterRules as rules } from '../../lib/character/rules.ts';
  import { getSprite } from '../../lib/character/sprites.ts';
  import { defaultLook } from '../../lib/store/defaults.ts';
  import type { CharacterLook } from '../../lib/store/schema.ts';
  import ChipRadio from '../../lib/ui/ChipRadio.svelte';
  import Hobong360Dialog from '../../lib/ui/Hobong360Dialog.svelte';
  import Icon from '../../lib/ui/Icon.svelte';
  import Sprite from '../../lib/ui/Sprite.svelte';

  interface Props {
    look: CharacterLook;
    /** 지금 형태·호봉(큰 미리보기와 장식·소품 견본) */
    formId: string;
    step: number;
    /** 'auto' 소품을 고를 사용자 정보(직렬은 테마 id 로만) */
    owner: PropOwner;
    /** 라디오 묶음 이름·id 앞머리(한 화면에 둘이 있어도 겹치지 않게) */
    idPrefix?: string;
  }

  let { look = $bindable(), formId, step, owner, idPrefix = 'look' }: Props = $props();

  const c = rules.custom;
  const shown = paintShownFrom(rules);
  const formOr = (id: string | undefined) => rules.forms.find((f) => f.id === id)?.id ?? formId;
  /** 몸 색 견본은 솜봉이(설계 options: '견본마다 솜봉이 머리'), 볏은 깃봉이, 깃은 날봉이로 그린다 */
  const bodyForm = formOr(rules.forms[1]?.id);
  const crestForm = $derived(formOr(shown.crest?.id));
  const plumeForm = $derived(formOr(shown.plume?.id));

  /** '볏은 깃봉이부터, 깃 색은 날봉이부터 보여요. …' */
  const growNote = [
    [
      shown.crest ? `볏은 ${shown.crest.name}부터` : '',
      shown.plume ? `깃 색은 ${shown.plume.name}부터` : '',
    ]
      .filter(Boolean)
      .join(', ') + ' 보여요.',
    '지금 안 보여도 자라면 고른 색으로 나와요.',
    shown.crest ? `${shown.crest.name}의 흰 첫 깃은 깃 색과 상관없이 그대로예요.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  let mood = $state<MoodId>('work');
  /** 고르는 중인 모습을 옆·뒤에서 보는 창(#22) */
  let turning = $state(false);
  let status = $state('');
  /** 넓은 화면(900px~): 미리보기를 왼쪽 열에 고정하고 고르는 칸은 오른쪽에서 스크롤한다 */
  let wide = $state(false);
  onMount(() => {
    const mq = window.matchMedia('(min-width: 900px)');
    const update = () => (wide = mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  });

  const preview = $derived(resolveLook(rules, formId, step, mood, look, owner));
  const previewName = $derived(lookName(rules, preview));
  const grow = $derived(
    rules.forms.map((form) => ({
      form,
      look: resolveLook(rules, form.id, 0, 'work', look, owner),
    })),
  );

  const bare = (patch: Partial<CharacterLook>): CharacterLook => ({
    ...look,
    deco: { pin: null, chest: null, cheek: false },
    prop: 'none',
    ...patch,
  });
  const swatch = (form: string, value: CharacterLook, swatchStep = 0): Look =>
    resolveLook(rules, form, swatchStep, 'work', value, owner);

  // ── 견본 목록 ─────────────────────────────────────────────────────
  interface Option<T> {
    value: T;
    name: string;
    /** 이름 밑의 작은 설명('오색' 등) */
    sub?: string;
    look: Look;
  }

  // ── 장식 견본은 그 자리만 잘라 3배로(1배 전신으로는 2~3픽셀 핀·볼 터치가 구별되지 않는다) ──
  type Crop = { x: number; y: number; w: number; h: number };
  const anchorsOf = (form: string) =>
    getSprite(rules.forms.find((f) => f.id === form)?.body ?? '')?.anchors ?? {};
  const decoCrop = $derived.by((): Record<'pin' | 'chest' | 'cheek', Crop> => {
    const a = anchorsOf(formId);
    const [hx, hy] = a.head ?? [24, 16];
    const [ex, ey] = a.eyes ?? [24, 24];
    const [cx, cy] = a.chest ?? [29, 32];
    return {
      // 핀(머리 왼쪽 위)과 눈
      pin: { x: hx - 12, y: hy - 2, w: 20, h: 14 },
      // 목걸이·넥타이와 오른쪽 가슴 배지
      chest: { x: cx - 13, y: cy - 4, w: 20, h: 14 },
      // 두 눈 아래 볼
      cheek: { x: ex - 10, y: ey - 3, w: 20, h: 9 },
    };
  });

  const bodies = $derived<Option<string>[]>(
    c.bodies.map((b) => ({
      value: b.id,
      name: b.name,
      look: swatch(bodyForm, { ...defaultLook(), body: b.id, prop: 'none' }),
    })),
  );
  const crests = $derived<Option<string>[]>(
    c.crests.map((p) => ({
      value: p.id,
      name: p.name,
      look: swatch(crestForm, bare({ crest: p.id })),
    })),
  );
  const autoPlume = $derived(resolveCustom(rules, { ...look, plume: 'auto' }, owner).custom.plume);
  const plumes = $derived<Option<string>[]>(
    c.plumes.map((p) => ({
      value: p.id,
      name: p.id === 'auto' ? '알아서' : plumeName(p),
      sub:
        p.id === 'auto'
          ? plumeName(autoPlume)
          : plumeClashes(rules, look.body, p.id)
            ? '몸 색과 비슷해요'
            : undefined,
      look: swatch(plumeForm, bare({ plume: p.id })),
    })),
  );
  const decoOptions = (slot: 'pin' | 'chest') =>
    [null, ...c.decos.filter((d) => d.slot === slot)].map((d) => ({
      value: d ? d.id : null,
      name: d ? d.name : '없음',
      look: swatch(formId, {
        ...look,
        prop: 'none',
        deco: { ...look.deco, [slot]: d ? d.id : null },
      }),
    }));
  const pins = $derived<Option<string | null>[]>(decoOptions('pin'));
  const chests = $derived<Option<string | null>[]>(decoOptions('chest'));
  const cheekRule = c.decos.find((d) => d.slot === 'cheek');
  const cheeks = $derived<Option<boolean>[]>(
    cheekRule
      ? [false, true].map((on) => ({
          value: on,
          name: on ? cheekRule.name : '안 함',
          look: swatch(formId, { ...look, prop: 'none', deco: { ...look.deco, cheek: on } }),
        }))
      : [],
  );

  /** 호봉 소품(왼손, 9호봉부터 결재판) */
  const stepProp = rules.items.find((i) => i.slot === 'handL');
  const stepPropRule = stepProp ? c.props.find((p) => p.sprite === stepProp.sprite) : undefined;
  /** '직렬 따라'가 지금 드는 것 */
  const autoProp = $derived.by(() => {
    const r = resolveProp(rules, 'auto', owner);
    if (r !== null && r !== 'step') return { id: r.id, sub: r.name };
    if (r === 'step' && stepProp && stepPropRule) {
      return step >= stepProp.minStep
        ? { id: stepPropRule.id, sub: stepProp.name }
        : { id: 'none', sub: `${stepProp.minStep}호봉부터 ${stepProp.name}` };
    }
    return { id: 'none', sub: '들지 않아요' };
  });
  /** 직렬을 고르지 않는 직종(특정직)은 'auto' 가 호봉 소품이다(직종 소품은 직접 고를 때만 — look.ts resolveProp) */
  const special = $derived(owner.bySeries === false);
  const ownTrackProp = $derived(trackPropOf(rules, owner.track));
  const propOptions = $derived<Option<string>[]>([
    {
      value: 'auto',
      name: special ? '호봉 따라' : '직렬 따라',
      sub: autoProp.sub,
      look: swatch(formId, { ...look, prop: autoProp.id }),
    },
    { value: 'none', name: '들지 않기', look: swatch(formId, { ...look, prop: 'none' }) },
    ...c.props.map((p) => ({
      value: p.id,
      name: p.name,
      sub: p.id === ownTrackProp?.id ? '내 직종' : undefined,
      look: swatch(formId, { ...look, prop: p.id }),
    })),
  ]);

  /** 견본 한 칸(그리는 쪽이 값의 종류를 몰라도 되게 고름 여부·고르기를 함께 싣는다) */
  interface Tile {
    key: string;
    name: string;
    sub?: string;
    look: Look;
    crop?: Crop;
    checked: boolean;
    pick: () => void;
  }
  function tilesOf<T>(
    options: Option<T>[],
    checked: (value: T) => boolean,
    pick: (value: T) => void,
    crop?: Crop,
  ): Tile[] {
    return options.map((o) => ({
      key: String(o.value),
      name: o.name,
      sub: o.sub,
      look: o.look,
      crop,
      checked: checked(o.value),
      pick: () => pick(o.value),
    }));
  }

  // ── 이 버전이 모르는 값 ─────────────────────────────────────────────
  const unknown = $derived({
    body: !c.bodies.some((b) => b.id === look.body),
    crest: !c.crests.some((p) => p.id === look.crest),
    plume: !c.plumes.some((p) => p.id === look.plume),
    pin: look.deco.pin !== null && !c.decos.some((d) => d.slot === 'pin' && d.id === look.deco.pin),
    chest:
      look.deco.chest !== null &&
      !c.decos.some((d) => d.slot === 'chest' && d.id === look.deco.chest),
    prop: look.prop !== 'auto' && look.prop !== 'none' && !c.props.some((p) => p.id === look.prop),
  });
  const anyUnknown = $derived(Object.values(unknown).some(Boolean));

  function set(patch: Partial<CharacterLook>) {
    look = { ...look, ...patch, deco: { ...look.deco, ...patch.deco } };
    status = '';
  }
  function setDeco(patch: Partial<CharacterLook['deco']>) {
    look = { ...look, deco: { ...look.deco, ...patch } };
    status = '';
  }
  function surprise() {
    const next = randomLook(
      rules,
      untrack(() => look),
    );
    look = next;
    status = lookChangeText(resolveCustom(rules, next, owner).custom);
  }
  function reset() {
    look = defaultLook();
    status = '기본 모습으로 되돌렸어요.';
  }
</script>

{#snippet tiles(group: string, legend: string, options: Tile[], note?: string, isUnknown?: boolean)}
  <fieldset class="group" id="{idPrefix}-{group}">
    <legend>{legend}</legend>
    {#if note}<p class="cap muted">{note}</p>{/if}
    {#if isUnknown}
      <p class="cap muted" id="{idPrefix}-{group}-unknown">
        이 버전이 모르는 값이 골라져 있어요. 기본 모습으로 그리고, 다른 것을 고르기 전까지 그대로
        둬요.
      </p>
    {/if}
    <div class="grid">
      {#each options as option (option.key)}
        <label class="sw">
          <input
            type="radio"
            name="{idPrefix}-{group}"
            value={option.key}
            checked={option.checked}
            onchange={option.pick}
          />
          <span class="tile">
            <span class="pic">
              {#if option.crop}
                <Sprite look={option.look} scale={3} animate={false} crop={option.crop} />
              {:else}
                <Sprite look={option.look} scale={1} animate={false} />
              {/if}
            </span>
            <span class="name">{option.name}</span>
            {#if option.sub}<span class="sub">{option.sub}</span>{/if}
          </span>
        </label>
      {/each}
    </div>
  </fieldset>
{/snippet}

<div class="editor" class:two={wide}>
  <!-- 좁은 폭: 미리보기 줄(.top)만 대화상자 위에 붙어 고르는 동안 보인다. 넓은 폭(900px~): 왼쪽 열 전체가 붙는다 -->
  <div class="side stack wide">
    <div class="top">
      <div class="stage">
        <Sprite look={preview} scale={wide ? 3 : 2} label={previewName} />
      </div>
      <p class="cap preview-name" aria-hidden="true">{previewName}</p>
    </div>
    <div class="stack controls">
      <div class="stack">
        <span class="cap muted" id="{idPrefix}-mood-label">미리보기 기분</span>
        <ChipRadio
          labelledby="{idPrefix}-mood-label"
          options={[
            { value: 'work', label: '근무 중' },
            { value: 'celebrate', label: '축하' },
          ]}
          value={mood}
          onchange={(m) => (mood = m)}
        />
      </div>
      <div class="btn-row">
        <button type="button" class="btn small" onclick={surprise}>
          <Icon name="icon-star" /> 아무거나
        </button>
        <button type="button" class="btn small" onclick={reset}>
          <Icon name="icon-undo" /> 기본으로
        </button>
        <button
          type="button"
          class="btn small"
          id="{idPrefix}-turn"
          onclick={() => (turning = true)}
        >
          <Icon name="icon-turn" /> 돌려 보기
        </button>
      </div>
      <!-- 결과 문장이 들어와도 아래가 밀리지 않게 설명 자리를 결과 문장이 대신한다(높이는 두 줄로 잡아 둔다) -->
      <div class="say">
        <p class="cap muted" aria-hidden={status !== ''} class:gone={status !== ''}>
          '아무거나'는 손 소품은 그대로 두고 색과 장식만 바꿔요.
        </p>
        <p class="cap" role="status" id="{idPrefix}-status">{status}</p>
      </div>
    </div>
  </div>

  <div class="options stack wide">
    {#if anyUnknown}
      <p class="note" id="{idPrefix}-unknown">
        새 버전에서 고른 꾸미기가 들어 있어요. 이 버전은 그 부분을 기본 모습으로 그리고, 다른 것을
        고르기 전까지 저장값을 그대로 둬요.
      </p>
    {/if}

    <section class="stack" aria-labelledby="{idPrefix}-grow-title">
      <h3 class="cap" id="{idPrefix}-grow-title">자라면 이렇게</h3>
      <ul class="grow">
        {#each grow as g (g.form.id)}
          <li>
            <span class="pic"><Sprite look={g.look} scale={1} animate={false} /></span>
            <span class="cap">{g.form.name}</span>
          </li>
        {/each}
      </ul>
      <p class="cap muted">{growNote}</p>
    </section>

    {@render tiles(
      'body',
      '몸 색',
      tilesOf(
        bodies,
        (v) => v === look.body,
        (v) => set({ body: v }),
      ),
      undefined,
      unknown.body,
    )}
    {@render tiles(
      'crest',
      '볏 색',
      tilesOf(
        crests,
        (v) => v === look.crest,
        (v) => set({ crest: v }),
      ),
      shown.crest ? `${shown.crest.name}부터 보여요.` : undefined,
      unknown.crest,
    )}
    {@render tiles(
      'plume',
      '깃 색',
      tilesOf(
        plumes,
        (v) => v === look.plume,
        (v) => set({ plume: v }),
      ),
      `${shown.plume ? `${shown.plume.name}부터 보여요. ` : ''}'알아서'는 몸 색과 겹치지 않는 깃을 골라요.`,
      unknown.plume,
    )}
    {@render tiles(
      'pin',
      '머리핀',
      tilesOf(
        pins,
        (v) => v === look.deco.pin,
        (v) => setDeco({ pin: v }),
        decoCrop.pin,
      ),
      '모자를 쓰는 때(휴가·잠·축하)에는 가려져요.',
      unknown.pin,
    )}
    {@render tiles(
      'chest',
      '가슴 배지',
      tilesOf(
        chests,
        (v) => v === look.deco.chest,
        (v) => setDeco({ chest: v }),
        decoCrop.chest,
      ),
      '꽃목걸이를 건 날(휴가)에는 가려져요.',
      unknown.chest,
    )}
    {#if cheeks.length > 0}
      {@render tiles(
        'cheek',
        '볼 터치',
        tilesOf(
          cheeks,
          (v) => v === look.deco.cheek,
          (v) => setDeco({ cheek: v }),
          decoCrop.cheek,
        ),
      )}
    {/if}
    {@render tiles(
      'prop',
      '손에 드는 소품',
      tilesOf(
        propOptions,
        (v) => v === look.prop,
        (v) => set({ prop: v }),
      ),
      special
        ? `${stepProp ? `'호봉 따라'는 ${stepProp.minStep}호봉부터 ${josa(stepProp.name, '을', '를')} 들어요. ` : ''}직종 소품은 직접 고를 때만 들고, 들면 카드와 홈에서 직종이 짐작될 수 있어요. 점심·퇴근 뒤에는 내려놓아요.`
        : '직렬과 따로 저장해요. 직렬 이름을 숨겨도 손에 든 소품으로 직렬이 짐작될 수 있어요. 점심·퇴근 뒤에는 내려놓아요.',
      unknown.prop,
    )}
  </div>
</div>

{#if turning}
  <Hobong360Dialog
    look={preview}
    label={previewName}
    caption="고르는 중인 모습이에요. 옆·뒤에서도 고른 색과 장식이 보여요."
    onclose={() => (turning = false)}
  />
{/if}

<style>
  .editor {
    display: grid;
    gap: 12px;
  }
  /* 좁은 폭: 왼쪽 열 상자를 없애 미리보기 줄(.top)이 대화상자 본문 기준으로 위에 붙는다 */
  .editor:not(.two) .side {
    display: contents;
  }
  .editor.two {
    grid-template-columns: minmax(220px, 260px) minmax(0, 1fr);
    align-items: start;
    gap: 18px;
  }
  .editor.two .side {
    position: sticky;
    top: 0;
    z-index: 2;
  }
  .top {
    display: flex;
    gap: 9px;
    align-items: center;
  }
  .editor:not(.two) .top {
    position: sticky;
    /* 대화상자 본문의 안쪽 여백(12px)만큼 위로 올려 붙인다 */
    top: -12px;
    z-index: 2;
    margin: -12px -12px 0;
    padding: 12px 12px 6px;
    background: var(--panel);
    box-shadow: 0 var(--u) 0 var(--panel-2);
  }
  .editor.two .top {
    flex-direction: column;
    align-items: flex-start;
  }
  .stage {
    flex: none;
    display: grid;
    place-items: center;
    padding: 6px;
    margin: var(--u);
    background: linear-gradient(var(--stage) 0 calc(100% - 21px), var(--stage-ground) 0 100%);
    box-shadow: var(--frame);
  }
  .controls {
    min-width: 0;
  }
  .preview-name {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .say {
    display: grid;
    /* 두 줄 높이를 늘 잡아 둔다(결과 문장이 들어와도 아래가 밀리지 않게) */
    min-height: 36px;
  }
  .say > p {
    grid-area: 1 / 1;
    margin: 0;
  }
  .say .gone {
    visibility: hidden;
  }
  h3 {
    margin: 0;
    font-size: inherit;
    font-weight: normal;
  }
  .grow {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .grow li {
    display: grid;
    justify-items: center;
    gap: 3px;
    min-width: 56px;
  }
  .pic {
    display: block;
    background: var(--stage);
    line-height: 0;
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
    min-width: 0;
  }
  legend {
    padding: 0;
    margin-bottom: 3px;
  }
  .group {
    display: grid;
    gap: 6px;
  }
  /* 견본 칸 수는 4·8 로 맞춘다(몸 색 8개가 7+1 로 갈라지지 않게) */
  .grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }
  .editor.two .grid {
    grid-template-columns: repeat(8, minmax(0, 1fr));
  }
  .sw {
    position: relative;
    display: block;
    min-width: 0;
    cursor: pointer;
  }
  /* 진짜 라디오를 견본 전체에 투명하게 덮는다(어디를 눌러도 고른다, 방향키·Tab 은 라디오 그대로) */
  .sw input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
    z-index: 1;
  }
  .tile {
    position: relative;
    display: grid;
    justify-items: center;
    align-content: start;
    gap: 3px;
    min-height: 44px;
    height: 100%;
    padding: 6px 3px;
    margin: var(--u);
    background: var(--btn);
    color: var(--ink);
    box-shadow: var(--frame);
    text-align: center;
  }
  .name {
    font-family: var(--font-cap);
    font-size: 12px;
    line-height: 18px;
    overflow-wrap: anywhere;
  }
  .sub {
    font-family: var(--font-cap);
    font-size: 12px;
    line-height: 15px;
    color: var(--ink-2);
    overflow-wrap: anywhere;
  }
  /* 고른 견본: 두꺼운 테두리(3px 더) + ✓ 표시(색만으로 구별하지 않는다) */
  .sw input:checked + .tile {
    box-shadow:
      var(--frame),
      0 0 0 calc(var(--u) * 2) var(--accent);
  }
  .sw input:checked + .tile::after {
    content: '✓';
    content: '✓' / '';
    position: absolute;
    top: 0;
    right: 0;
    min-width: 18px;
    padding: 0 3px;
    background: var(--accent);
    color: var(--accent-ink);
    font-family: var(--font-cap);
    font-size: 12px;
    line-height: 18px;
  }
  /* 키보드 포커스: 고른 견본의 파란 띠(채운 링)와 다른 모양·색 — 띠 바깥에 틈을 두고 잉크색 점선 */
  .sw input:focus-visible + .tile {
    outline: 2px dashed var(--ink);
    outline-offset: 9px;
  }
  @media (forced-colors: active) {
    .tile,
    .stage {
      border: var(--u) solid CanvasText;
    }
    .sw input:checked + .tile {
      border: calc(var(--u) * 2) solid Highlight;
    }
    .sw input:checked + .tile::after {
      forced-color-adjust: none;
      background: Highlight;
      color: HighlightText;
    }
    .sw input:focus-visible + .tile {
      outline-color: Highlight;
    }
    .pic {
      forced-color-adjust: none;
    }
  }
</style>
