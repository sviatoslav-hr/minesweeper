export type SoundName = 'click' | 'lost' | 'win';

const SOUND_SOURCES: Record<SoundName, string> = {
	click: './kenneynl/UI_SFX/click3.wav',
	lost: './kenneynl/jingles/jingles_SAX07.ogg',
	win: './lokif/positive.wav',
};

const SOUND_VOLUMES: Record<SoundName, number> = {
	click: 0.5,
	lost: 0.5,
	win: 0.5,
};

export class SoundManager {
	private readonly context = new AudioContext();
	private readonly sounds = new Map<SoundName, Promise<AudioBuffer | null>>();

	constructor() {
		for (const name of Object.keys(SOUND_SOURCES) as SoundName[]) {
			this.sounds.set(
				name,
				this.load(name).catch((error) => {
					console.warn(`[Sound] Failed to load "${name}"`, error);
					return null;
				}),
			);
		}
	}

	readonly unlock = (): void => {
		if (this.context.state === 'suspended') {
			void this.context.resume();
		}
	};

	async play(name: SoundName): Promise<void> {
		try {
			if (this.context.state === 'suspended') await this.context.resume();

			const buffer = await this.sounds.get(name);
			if (!buffer) return;

			const source = this.context.createBufferSource();
			const gain = this.context.createGain();
			source.buffer = buffer;
			gain.gain.value = SOUND_VOLUMES[name];
			source.connect(gain);
			gain.connect(this.context.destination);
			source.addEventListener('ended', () => {
				source.disconnect();
				gain.disconnect();
			});
			source.start();
		} catch (error) {
			console.warn(`[Sound] Failed to play "${name}"`, error);
		}
	}

	private async load(name: SoundName): Promise<AudioBuffer> {
		const response = await fetch(SOUND_SOURCES[name]);
		if (!response.ok) {
			throw new Error(`Failed to fetch "${SOUND_SOURCES[name]}": ${response.status}`);
		}
		return this.context.decodeAudioData(await response.arrayBuffer());
	}
}
