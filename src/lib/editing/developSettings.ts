// ── LightCraft DevelopSettings bridge ──
// Maps Galleria's editor state (camelCase, UI-shaped) to/from LightCraft's
// `DevelopSettings` JSON (the wire + persistence format of the new engine).
// Field names/casings mirror the Rust serde derives exactly; every field is
// optional on the Rust side (`#[serde(default)]`), so partials are valid.

import type { AdjustmentState, ColorWheelState, MaskLayer, ToneCurvePoint } from './adjustments';
import { cloneAdjustments, defaultAdjustments } from './adjustments';

export interface DevPoint { x: number; y: number }
export interface DevHsl { hue: number; sat: number; lum: number }
export interface DevWheel { hue: number; sat: number; lum: number }

export interface DevelopSettings {
    version?: number;
    profile?: { id?: string; amount?: number };
    treatment?: 'color' | 'bw';
    wb?: {
        mode?: 'asShot' | 'auto' | 'daylight' | 'cloudy' | 'shade' | 'tungsten' | 'fluorescent' | 'flash' | 'custom';
        temp?: number;
        tint?: number;
    };
    light?: {
        exposure?: number; contrast?: number; highlights?: number;
        shadows?: number; whites?: number; blacks?: number;
    };
    curve?: {
        highlights?: number; lights?: number; darks?: number; shadows?: number;
        split_shadows?: number; split_mid?: number; split_highlights?: number;
        master?: DevPoint[]; red?: DevPoint[]; green?: DevPoint[]; blue?: DevPoint[];
        refine_saturation?: number;
    };
    color?: { vibrance?: number; saturation?: number };
    mixer?: Partial<Record<'red' | 'orange' | 'yellow' | 'green' | 'aqua' | 'blue' | 'purple' | 'magenta', DevHsl>>;
    bw_mix?: Partial<Record<'red' | 'orange' | 'yellow' | 'green' | 'aqua' | 'blue' | 'purple' | 'magenta', number>>;
    grading?: {
        shadows?: DevWheel; midtones?: DevWheel; highlights?: DevWheel; global?: DevWheel;
        blending?: number; balance?: number;
    };
    effects?: { texture?: number; clarity?: number; dehaze?: number };
    vignette?: {
        amount?: number; midpoint?: number; roundness?: number; feather?: number;
        highlights?: number; style?: 'highlightPriority' | 'colorPriority' | 'paintOverlay';
    };
    grain?: { amount?: number; size?: number; roughness?: number; seed?: number };
    detail?: {
        sharpen_amount?: number; sharpen_radius?: number; sharpen_detail?: number; sharpen_masking?: number;
        nr_luminance?: number; nr_detail?: number; nr_contrast?: number;
        nr_color?: number; nr_color_detail?: number; nr_color_smoothness?: number;
    };
    optics?: {
        remove_ca?: boolean; lens_profile?: boolean;
        profile_distortion?: number; profile_vignetting?: number;
        defringe_purple_amount?: number; defringe_green_amount?: number;
        distortion?: number; vignetting?: number; vignetting_midpoint?: number;
        ca_red?: number; ca_blue?: number;
    };
    geometry?: Record<string, unknown>;
    crop?: {
        geometry?: { rect?: { x0?: number; y0?: number; x1?: number; y1?: number }; angle?: number };
        aspect?: [number, number] | null;
        flip_h?: boolean;
        flip_v?: boolean;
    };
    orientation?: string;
    masks?: DevMask[];
    [key: string]: unknown;
}

export interface DevMask {
    id: number;
    name?: string;
    visible?: boolean;
    invert?: boolean;
    components: Array<{
        op?: 'add' | 'subtract' | 'intersect';
        invert?: boolean;
        shape:
            | { kind: 'linear'; start: DevPoint; end: DevPoint }
            | { kind: 'radial'; center: DevPoint; rx: number; ry: number; angle: number; feather: number; invert: boolean }
            | { kind: 'brush'; strokes: Array<{ points: DevPoint[]; size: number; feather: number; flow: number; density: number; erase: boolean }> };
    }>;
    adjust?: Record<string, number>;
}

const MIXER_BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const;

/** Galleria hue sliders are ±180°; LightCraft mixer hue is ±100. */
const HUE_TO_DEV = 100 / 180;
const HUE_FROM_DEV = 180 / 100;

/** Stable numeric mask id (LightCraft ids are u32) from Galleria's string ids. */
function maskIdHash(id: string): number {
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) {
        h ^= id.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function toPoints(curve: ToneCurvePoint[]): DevPoint[] {
    // Galleria curves are 0-255; LightCraft wants normalized 0..1. Identity stays identity.
    return curve.map(p => ({ x: p.x / 255, y: p.y / 255 }));
}

function fromPoints(curve: DevPoint[] | undefined): ToneCurvePoint[] {
    if (!curve || curve.length < 2) return [{ x: 0, y: 0 }, { x: 255, y: 255 }];
    return curve.map(p => ({ x: Math.round(p.x * 255), y: Math.round(p.y * 255) }));
}

function wheelToDev(w: ColorWheelState): DevWheel {
    return { hue: w.hue, sat: w.saturation, lum: w.luminance };
}

function wheelFromDev(w: DevWheel | undefined): ColorWheelState {
    return { hue: w?.hue ?? 0, saturation: w?.sat ?? 0, luminance: w?.lum ?? 0 };
}

/** Partial AdjustmentState (a mask's local offsets) → LightCraft LocalAdjustments. */
function localAdjustmentsToDev(a: Partial<AdjustmentState>): Record<string, number> {
    const out: Record<string, number> = {};
    // `hue` exists only as a mask-local control (LightCraft LocalAdjustments), not
    // on the global AdjustmentState — hence the string-keyed access.
    const direct: Array<[string, string]> = [
        ['exposure', 'exposure'], ['contrast', 'contrast'], ['highlights', 'highlights'],
        ['shadows', 'shadows'], ['whites', 'whites'], ['blacks', 'blacks'],
        ['texture', 'texture'], ['clarity', 'clarity'], ['dehaze', 'dehaze'],
        ['saturation', 'saturation'], ['tint', 'tint'], ['temperature', 'temp'],
        ['hue', 'hue'],
    ];
    for (const [ui, dev] of direct) {
        const v = (a as Record<string, unknown>)[ui];
        if (typeof v === 'number' && v !== 0) {
            out[dev] = ui === 'temperature' ? v - 6500 : v; // local temp is an offset
        }
    }
    if (typeof a.sharpenAmount === 'number' && a.sharpenAmount !== 0) out.sharpness = Math.min(100, a.sharpenAmount * (100 / 150));
    if (typeof a.nrLuminance === 'number' && a.nrLuminance !== 0) out.noise = a.nrLuminance;
    return out;
}

function localAdjustmentsFromDev(dev: Record<string, number> | undefined): Partial<AdjustmentState> {
    const out: Partial<AdjustmentState> = {};
    if (!dev) return out;
    const pairs: Array<[string, string]> = [
        ['exposure', 'exposure'], ['contrast', 'contrast'], ['highlights', 'highlights'],
        ['shadows', 'shadows'], ['whites', 'whites'], ['blacks', 'blacks'],
        ['texture', 'texture'], ['clarity', 'clarity'], ['dehaze', 'dehaze'],
        ['saturation', 'saturation'], ['tint', 'tint'], ['hue', 'hue'],
    ];
    for (const [d, ui] of pairs) {
        if (typeof dev[d] === 'number') (out as Record<string, number>)[ui] = dev[d];
    }
    if (typeof dev.temp === 'number') out.temperature = dev.temp + 6500;
    if (typeof dev.sharpness === 'number') out.sharpenAmount = dev.sharpness * 1.5;
    if (typeof dev.noise === 'number') out.nrLuminance = dev.noise;
    return out;
}

function masksToDev(masks: MaskLayer[]): DevMask[] {
    return masks
        .filter(m => m.active)
        .map(m => {
            const featherPct = m.radius > 0 ? Math.max(0, Math.min(100, (m.feather / m.radius) * 100)) : 50;
            const shape: DevMask['components'][0]['shape'] =
                m.type === 'linear_gradient'
                    ? { kind: 'linear', start: { x: m.x1, y: m.y1 }, end: { x: m.x2, y: m.y2 } }
                    : {
                        kind: 'radial',
                        center: { x: m.x1, y: m.y1 },
                        rx: m.radius, ry: m.radius, angle: 0,
                        feather: featherPct,
                        invert: false,
                    };
            return {
                id: maskIdHash(m.id),
                name: m.name,
                visible: true,
                invert: m.inverted,
                components: [{ op: 'add' as const, invert: false, shape }],
                adjust: localAdjustmentsToDev(m.adjustments),
            };
        });
}

function masksFromDev(dev: DevMask[] | undefined): MaskLayer[] {
    if (!dev) return [];
    return dev.map((m, i) => {
        const c = m.components?.[0];
        const s = c?.shape;
        const isLinear = s?.kind === 'linear';
        const center = s?.kind === 'radial' ? s.center : (s?.kind === 'linear' ? s.start : { x: 0.5, y: 0.5 });
        const radius = s?.kind === 'radial' ? s.rx : 0.2;
        const featherFrac = s?.kind === 'radial' ? (s.feather / 100) * radius : 0.05;
        return {
            id: String(m.id ?? i),
            name: m.name ?? `Mask ${i + 1}`,
            type: isLinear ? 'linear_gradient' : 'radial_gradient',
            active: m.visible !== false,
            inverted: m.invert === true,
            x1: center?.x ?? 0.5,
            y1: center?.y ?? 0.5,
            x2: s?.kind === 'linear' ? s.end.x : (center?.x ?? 0.5),
            y2: s?.kind === 'linear' ? s.end.y : (center?.y ?? 0.5),
            radius,
            feather: featherFrac,
            adjustments: localAdjustmentsFromDev(m.adjust),
        };
    });
}

/** Full UI state → LightCraft DevelopSettings (the `process_image` / export payload). */
export function toDevelopSettings(adj: AdjustmentState): DevelopSettings {
    const mixer: NonNullable<DevelopSettings['mixer']> = {};
    const bwMix: NonNullable<DevelopSettings['bw_mix']> = {};
    MIXER_BANDS.forEach((band, i) => {
        const h = adj.hsl[i] ?? { hue: 0, saturation: 0, luminance: 0 };
        mixer[band] = { hue: h.hue * HUE_TO_DEV, sat: h.saturation, lum: h.luminance };
        bwMix[band] = adj.bwMix?.[i] ?? 0;
    });

    return {
        version: 1,
        treatment: adj.treatment,
        wb: {
            mode: adj.wbMode ?? 'asShot',
            temp: adj.temperature,
            tint: adj.tint,
        },
        light: {
            exposure: adj.exposure, contrast: adj.contrast, highlights: adj.highlights,
            shadows: adj.shadows, whites: adj.whites, blacks: adj.blacks,
        },
        curve: {
            highlights: adj.tcParametricHighlights, lights: adj.tcParametricLights,
            darks: adj.tcParametricDarks, shadows: adj.tcParametricShadows,
            split_shadows: 25, split_mid: 50, split_highlights: 75,
            master: toPoints(adj.toneCurveRgb), red: toPoints(adj.toneCurveR),
            green: toPoints(adj.toneCurveG), blue: toPoints(adj.toneCurveB),
            refine_saturation: adj.refineSaturation ?? 100,
        },
        color: { vibrance: adj.vibrance, saturation: adj.saturation },
        mixer,
        bw_mix: bwMix,
        grading: {
            shadows: wheelToDev(adj.cgShadows), midtones: wheelToDev(adj.cgMidtones),
            highlights: wheelToDev(adj.cgHighlights), global: wheelToDev(adj.cgGlobal),
            blending: adj.cgBlending, balance: adj.cgBalance,
        },
        effects: { texture: adj.texture, clarity: adj.clarity, dehaze: adj.dehaze },
        vignette: {
            amount: adj.vignetteAmount, midpoint: adj.vignetteMidpoint,
            roundness: adj.vignetteRoundness, feather: adj.vignetteFeather,
            highlights: adj.vignetteHighlights, style: adj.vignetteStyle ?? 'highlightPriority',
        },
        grain: { amount: adj.grainAmount, size: adj.grainSize, roughness: adj.grainRoughness, seed: 0 },
        detail: {
            sharpen_amount: adj.sharpenAmount, sharpen_radius: adj.sharpenRadius,
            sharpen_detail: adj.sharpenDetail, sharpen_masking: adj.sharpenMasking,
            nr_luminance: adj.nrLuminance, nr_detail: adj.nrLumDetail, nr_contrast: adj.nrLumContrast,
            nr_color: adj.nrColor, nr_color_detail: adj.nrColorDetail, nr_color_smoothness: adj.nrColorSmooth,
        },
        optics: {
            remove_ca: adj.removeCA === true,
            lens_profile: adj.lensProfileEnabled === true,
            profile_distortion: adj.profileDistortion ?? 100,
            profile_vignetting: adj.profileVignetting ?? 100,
            defringe_purple_amount: adj.defringePurple ?? 0,
            defringe_green_amount: adj.defringeGreen ?? 0,
            distortion: adj.lensDistortion, vignetting: adj.lensVignetting, vignetting_midpoint: 50,
            ca_red: adj.lensCaRed, ca_blue: adj.lensCaBlue,
        },
        calibration: {
            shadows_tint: adj.calShadowTint,
            red_hue: adj.calRedHue,
            red_sat: adj.calRedSat,
            green_hue: adj.calGreenHue,
            green_sat: adj.calGreenSat,
            blue_hue: adj.calBlueHue,
            blue_sat: adj.calBlueSat,
        },
        crop: {
            geometry: {
                rect: {
                    x0: adj.cropX,
                    y0: adj.cropY,
                    x1: adj.cropX + adj.cropWidth,
                    y1: adj.cropY + adj.cropHeight,
                },
                angle: adj.cropRotation,
            },
            aspect: null, flip_h: false, flip_v: false,
        },
        orientation: 'Normal',
        masks: masksToDev(adj.masks || []),
    };
}

/** A saved/partial DevelopSettings JSON → UI state, layered over defaults. */
export function applyDevelopSettings(dev: DevelopSettings): AdjustmentState {
    const out = cloneAdjustments(defaultAdjustments);
    const wb = dev.wb ?? {};
    out.wbMode = (wb.mode as AdjustmentState['wbMode']) ?? 'asShot';
    out.temperature = wb.temp ?? 6500;
    out.tint = wb.tint ?? 0;
    const l = dev.light ?? {};
    out.exposure = l.exposure ?? 0;
    out.contrast = l.contrast ?? 0;
    out.highlights = l.highlights ?? 0;
    out.shadows = l.shadows ?? 0;
    out.whites = l.whites ?? 0;
    out.blacks = l.blacks ?? 0;
    const c = dev.color ?? {};
    out.vibrance = c.vibrance ?? 0;
    out.saturation = c.saturation ?? 0;
    const e = dev.effects ?? {};
    out.texture = e.texture ?? 0;
    out.clarity = e.clarity ?? 0;
    out.dehaze = e.dehaze ?? 0;
    const g = dev.grading ?? {};
    out.cgShadows = wheelFromDev(g.shadows);
    out.cgMidtones = wheelFromDev(g.midtones);
    out.cgHighlights = wheelFromDev(g.highlights);
    out.cgGlobal = wheelFromDev(g.global);
    out.cgBlending = g.blending ?? 50;
    out.cgBalance = g.balance ?? 0;
    const cu = dev.curve ?? {};
    out.tcParametricHighlights = cu.highlights ?? 0;
    out.tcParametricLights = cu.lights ?? 0;
    out.tcParametricDarks = cu.darks ?? 0;
    out.tcParametricShadows = cu.shadows ?? 0;
    out.toneCurveRgb = fromPoints(cu.master);
    out.toneCurveR = fromPoints(cu.red);
    out.toneCurveG = fromPoints(cu.green);
    out.toneCurveB = fromPoints(cu.blue);
    out.refineSaturation = cu.refine_saturation ?? 100;
    out.toneCurveChannel = 'rgb';
    if (dev.mixer) {
        out.hsl = MIXER_BANDS.map(band => {
            const b = dev.mixer?.[band];
            return { hue: (b?.hue ?? 0) * HUE_FROM_DEV, saturation: b?.sat ?? 0, luminance: b?.lum ?? 0 };
        });
    }
    out.treatment = dev.treatment === 'bw' ? 'bw' : 'color';
    if (dev.bw_mix) {
        out.bwMix = MIXER_BANDS.map(band => dev.bw_mix?.[band] ?? 0);
    }
    const v = dev.vignette ?? {};
    out.vignetteAmount = v.amount ?? 0;
    out.vignetteMidpoint = v.midpoint ?? 50;
    out.vignetteRoundness = v.roundness ?? 0;
    out.vignetteFeather = v.feather ?? 50;
    out.vignetteHighlights = v.highlights ?? 0;
    out.vignetteStyle = v.style ?? 'highlightPriority';
    const gr = dev.grain ?? {};
    out.grainAmount = gr.amount ?? 0;
    out.grainSize = gr.size ?? 25;
    out.grainRoughness = gr.roughness ?? 50;
    const d = dev.detail ?? {};
    out.sharpenAmount = d.sharpen_amount ?? 0;
    out.sharpenRadius = d.sharpen_radius ?? 1.0;
    out.sharpenDetail = d.sharpen_detail ?? 25;
    out.sharpenMasking = d.sharpen_masking ?? 0;
    out.nrLuminance = d.nr_luminance ?? 0;
    out.nrLumDetail = d.nr_detail ?? 50;
    out.nrLumContrast = d.nr_contrast ?? 50;
    out.nrColor = d.nr_color ?? 0;
    out.nrColorDetail = d.nr_color_detail ?? 50;
    out.nrColorSmooth = d.nr_color_smoothness ?? 50;
    const o = dev.optics ?? {};
    out.lensDistortion = o.distortion ?? 0;
    out.lensVignetting = o.vignetting ?? 0;
    out.lensCaRed = o.ca_red ?? 0;
    out.lensCaBlue = o.ca_blue ?? 0;
    out.removeCA = o.remove_ca === true;
    out.lensProfileEnabled = o.lens_profile === true;
    out.profileDistortion = o.profile_distortion ?? 100;
    out.profileVignetting = o.profile_vignetting ?? 100;
    out.defringePurple = o.defringe_purple_amount ?? 0;
    out.defringeGreen = o.defringe_green_amount ?? 0;
    const cal = dev.calibration as Record<string, number> | undefined;
    if (cal) {
        out.calShadowTint = cal.shadows_tint ?? 0;
        out.calRedHue = cal.red_hue ?? 0;
        out.calRedSat = cal.red_sat ?? 0;
        out.calGreenHue = cal.green_hue ?? 0;
        out.calGreenSat = cal.green_sat ?? 0;
        out.calBlueHue = cal.blue_hue ?? 0;
        out.calBlueSat = cal.blue_sat ?? 0;
    }
    const crop = dev.crop?.geometry;
    if (crop?.rect) {
        out.cropX = crop.rect.x0 ?? 0;
        out.cropY = crop.rect.y0 ?? 0;
        out.cropWidth = (crop.rect.x1 ?? 1) - (crop.rect.x0 ?? 0);
        out.cropHeight = (crop.rect.y1 ?? 1) - (crop.rect.y0 ?? 0);
    }
    out.cropRotation = crop?.angle ?? 0;
    out.masks = masksFromDev(dev.masks);
    return out;
}

/** A parse of saved edit params: LightCraft JSON (has a `light` object) vs the legacy Galleria blob. */
export function isDevelopSettings(parsed: unknown): parsed is DevelopSettings {
    return typeof parsed === 'object' && parsed !== null && typeof (parsed as any).light === 'object';
}

/** The `auto_enhance` response ({light, color, wb}) as a UI-state patch. */
export function autoPatchToState(patch: {
    light?: Record<string, number>;
    color?: Record<string, number>;
    wb?: { mode?: string; temp?: number; tint?: number };
}): Partial<AdjustmentState> {
    const l = patch.light ?? {};
    const c = patch.color ?? {};
    const wb = patch.wb ?? {};
    return {
        exposure: l.exposure ?? 0,
        contrast: l.contrast ?? 0,
        highlights: l.highlights ?? 0,
        shadows: l.shadows ?? 0,
        whites: l.whites ?? 0,
        blacks: l.blacks ?? 0,
        vibrance: c.vibrance ?? 0,
        saturation: c.saturation ?? 0,
        wbMode: 'custom',
        temperature: wb.temp ?? 6500,
        tint: wb.tint ?? 0,
    };
}
