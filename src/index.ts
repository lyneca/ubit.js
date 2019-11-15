import SerialPort from 'serialport';

function find_microbit(): Promise<SerialPort.PortInfo[]> {
    // Return { port, serial_number } of the first microbit connected,
    //  or null
    return SerialPort.list()
        .then((ports: SerialPort.PortInfo[]) => ports.filter(
            (port: SerialPort.PortInfo) =>
                port.vendorId == '0d28'
                && port.productId == '0204'
        ));
}

function get_ms(): number {
    return (new Date()).getTime();
}

interface Response {
    response: string;
    err: string;
}

function sleep(n: number): Promise<null> {
    return new Promise(resolve => setTimeout(resolve, n));
}

function get_serial(): Promise<SerialPort> {
    // Return a Serial object representing the first microbit connected
    return find_microbit()
    .then((device_list: SerialPort.PortInfo[]) => {
        if (device_list && device_list[0].path) {
            return new SerialPort(device_list[0].path, { baudRate: 115200 });
        } else if (device_list && device_list[0].comName) {
            return new SerialPort(device_list[0].comName, { baudRate: 115200 });
        } else throw new Error("No devices found!");
    });
}

export class Microbit {
    device: SerialPort;

    constructor(device: SerialPort) {
        this.device = device;
        device.setEncoding('utf8');
    }

    async raw_on() {
        // Put the microbit into raw mode
        console.log("Turning on raw mode...")

        this.device.read();
        await sleep(100);
        // Send CTRL-B to end raw mode if required.
        this.device.write('\x02\x03\x03\x03\x01');
        await sleep(100);
        this.device.read();
    }

    async raw_off() { 
        // Take the microbit out of raw mode
        this.device.read();
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

    async execute(commands: string[]): Promise<string> {
        // Execute a set of commands on the microbit
        this.device.read();
        await sleep(10);
        for (let command of commands) {
            // console.log(`Writing ${command}...`)
            this.device.read();
            await this.device.write(command);
            await this.device.write('\x04');
            await sleep(10);
        }
        await sleep(100);
        let response = this.device.read();
        let out: string = response.substring(2, response.length - 2).split('\x04');
        return out[0];
    }


    async ls(): Promise<string[]> {
        let result = await this.execute([
            'import os',
            'print("\\n".join([x for x in os.listdir()]))',
        ]).then((result: string) => result.trim().split('\r\n'));
        return result;
    }

    rm() {}
    put() {}
    get() {}
}

async function main() {
    const microbit = await get_serial().then(device => new Microbit(device))

    microbit.raw_on();
    const files: String[] = await microbit.ls();
    console.log(files);
    // microbit.execute(["from microbit import *","display.scroll('hello')"])
    // .then(r => console.log(r))
    // .catch(e => console.log("Error:", e));
    microbit.device.close();
}

main();
