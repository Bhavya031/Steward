import { writeFileSync } from "node:fs";

export function writeY4m(path: string, duration = 2, width = 96, height = 96, fps = 15): void {
  if (width % 2 || height % 2) throw new Error("Y4M dimensions must be even");
  const chunks = [Buffer.from(`YUV4MPEG2 W${width} H${height} F${fps}:1 Ip A1:1 C420jpeg\n`)];
  const luma = width * height;
  for (let index = 0; index < Math.round(duration * fps); index += 1) {
    const frame = Buffer.alloc(luma + luma / 2);
    for (let pixel = 0; pixel < luma; pixel += 1) frame[pixel] = (pixel + index * 17) % 220 + 16;
    frame.fill(96 + index % 32, luma, luma + luma / 4);
    frame.fill(128 + index % 24, luma + luma / 4);
    chunks.push(Buffer.from("FRAME\n"), frame);
  }
  writeFileSync(path, Buffer.concat(chunks));
}

export function writeWav(
  path: string,
  duration: number,
  options: { frequency?: number; amplitude?: number; sampleRate?: number; channels?: number } = {},
): void {
  const sampleRate = options.sampleRate ?? 48_000;
  const channels = options.channels ?? 1;
  const samples = Math.round(duration * sampleRate);
  const dataBytes = samples * channels * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + dataBytes, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * channels * 2, 28);
  wav.writeUInt16LE(channels * 2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(dataBytes, 40);
  const frequency = options.frequency ?? 440;
  const amplitude = options.amplitude ?? 0.2;
  for (let sample = 0; sample < samples; sample += 1) {
    const value = Math.round(Math.sin(2 * Math.PI * frequency * sample / sampleRate) * amplitude * 32767);
    for (let channel = 0; channel < channels; channel += 1) {
      wav.writeInt16LE(value, 44 + (sample * channels + channel) * 2);
    }
  }
  writeFileSync(path, wav);
}

export function writePdf(path: string, text: string | null): void {
  const content = text === null
    ? "40 40 200 160 re f"
    : `BT /F1 18 Tf 30 150 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.7\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((offset) => { pdf += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  writeFileSync(path, pdf);
}
