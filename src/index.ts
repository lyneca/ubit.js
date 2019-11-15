import SerialPort from 'serialport';
import os from 'os';
import fs from 'fs';

function find_microbits(): Promise<SerialPort.PortInfo[]> {
    // Return PortInfo of all microbits connected
    return SerialPort.list()
        .then((ports: SerialPort.PortInfo[]) => ports.filter(
            (port: SerialPort.PortInfo) =>
                port.vendorId == '0d28'
                && port.productId == '0204'
        ));
}

interface Response {
    response: string;
    err: string;
}

function sleep(n: number): Promise<null> {
    return new Promise(resolve => setTimeout(resolve, n));
}

function get_first_microbit(): Promise<SerialPort> {
    // Return a Serial object representing the first microbit connected
    return find_microbits()
        .then((device_list: SerialPort.PortInfo[]) => {
            if (device_list && device_list[0].path) {
                return new SerialPort(device_list[0].path, { baudRate: 115200 });
            } else throw new Error("No devices found!");
        });
}

function serial_from_portinfo(port: SerialPort.PortInfo): SerialPort | undefined {
    if (port.path)
        return new SerialPort(port.path, { baudRate: 115200 });
    else return undefined;
}

function serial_from_port(port: string): SerialPort {
    return new SerialPort(port, { baudRate: 115200 });
}

export class Microbit {
    device: SerialPort;
    parser: SerialPort.parsers.Delimiter;

    static async init(device: SerialPort): Promise<Microbit> {
        const microbit: Microbit = new Microbit(device);
        await microbit.raw_on();
        return microbit;
    }

    constructor(device: SerialPort) {
        this.device = device;
        device.setEncoding('utf8');
        this.parser = this.device.pipe(new SerialPort.parsers.Delimiter({ delimiter: "\x04>" }))
    }

    async raw_on() {
        // Put the microbit into raw mode
        console.log("Turning on raw mode...")

        await sleep(100);
        // Send CTRL-B to end raw mode if required.
        this.device.write('\x02\x03\x03\x03\x01\x04');
        await sleep(100);
    }

    async raw_off() { 
        // Take the microbit out of raw mode
        await sleep(100);
        console.log("Turning off raw mode...")
        this.device.write('\x02');  // Send CTRL-B to get out of raw mode.
        await sleep(100);
    }

    write(string: string) {
        return new Promise((resolve) => {
            this.device.write(string, 'utf8', resolve);
        });
    }

    async execute(commands: string[], start?: string): Promise<string> {
        // Execute a set of commands on the microbit
        for (let command of commands) {
            // console.log(`send: ${JSON.stringify(command)}`)
            await this.device.write(command);
            await this.device.write('\x04');
            await sleep(10);
        }
        if (!start) return "";
        return new Promise((resolve) => {
            this.parser.on('data', data => {
                if (data != "OK\x04") {
                    const payload = data.toString().substring(2);
                    if (payload.split('\x04').length > 1 && payload.split('\x04')[1]) {
                        console.error(payload.split('\x04')[1]);
                    }
                    if (start && payload.startsWith(start)) {
                        resolve(payload.split('\x04')[0].substring(start.length));
                    } else if (!start) {
                        resolve(payload.split('\x04')[0]);
                    }
                }
            });
        });
    }
    
    async close() {
        await this.raw_off();
        this.device.close();
    }

    async ls(): Promise<string[]> {
        let result = await this.execute([
            'import os',
            'print("files:", "\\n".join([x for x in os.listdir()]))',
        ], "files: ").then((result: string) => result.trim().split('\r\n'));
        return result;
    }

    async rm(filename: string) {
        await this.execute([
            'import os',
            `os.remove('${filename}')`,
        ])
    }

    async put(filename: string, target?: string) {
        if (!target) target = filename;
        const stream = fs.createReadStream(filename);
        const commands: string[] = [
            `fd = open("${target}", "wb")`,
            'f = fd.write'
        ];
        await new Promise(resolve => {
            stream.on('data', chunk => {
                commands.push(`f('${
                    chunk.toString()
                        .replace(/'/g, "\\'")
                        .replace(/\r/g, "")
                        .replace(/\n/g, "\\n")
                }')`)
            });
            stream.on('close', () => resolve());
        });
        commands.push('fd.close()');
        await this.execute(commands);
        stream.close()
    }

    async get(filename: string, target?: string) {
        if (!target) target = filename;
        const stream = fs.createWriteStream(target);
        const commands: string[] = [
            'from microbit import uart as u',
            `f = open("${filename}", "rb")`,
            'u.write(b"file: " + f.read())',
            'f.close()'
        ];

        const contents = await this.execute(commands, 'file: ');
        console.log(JSON.stringify(contents));
        stream.write(contents);
        stream.close();
    }
}

async function main() {
    const microbit = await get_first_microbit()
        .then(Microbit.init)
    console.log(await microbit.ls());
    await microbit.put('test');
    console.log(await microbit.ls());
    await microbit.rm('test');
    console.log(await microbit.ls());
    microbit.close();
}

main();
