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

function sleep(ms: number) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    })
}

function get_ms(): number {
    return (new Date()).getTime();
}

function flush_to_msg(device: SerialPort, msg: string): string {
    // Read the rx serial data until we reach an expected message.
    let data: string = "";
    let incoming;
    const start_time = get_ms();
    while (!data.endsWith(msg)) {
        incoming = device.read(1);
        if (incoming !== null) data += incoming;
        if (get_ms() > start_time + 1000) return null;
    }
    return data;
}

async function raw_on(device: SerialPort): void {
    // Put the microbit into raw mode

    const raw_repl_msg: string = 'raw REPL; CTRL-B to exit\r\n>';

    // Send CTRL-B to end raw mode if required.
    device.write('\x02');

    // Send CTRL-C three times between pauses to break out of loop.
    
    for (let i: number = 0; i < 3; i++) {
        device.write('\r\x03');
        await sleep(10);
    }

    device.drain();

    // Go into raw mode with CTRL-A.
    device.write('\r\x01');
    flush_to_msg(device, raw_repl_msg)

    // Soft Reset with CTRL-D
    device.write('\x04')
    flush_to_msg(device, 'soft reboot\r\n')

    // Some MicroPython versions/ports/forks provide a different message after
    // a Soft Reset, check if we are in raw REPL, if not send a CTRL-A again
    const data = flush_to_msg(device, raw_repl_msg);

    if (data === null) {
        device.write('\r\x01')
        flush_to_msg(device, raw_repl_msg)
    }
    device.drain();
}

function raw_off(device: SerialPort): void { 
    // Take the microbit out of raw mode
    device.write('\x02');  // Send CTRL-B to get out of raw mode.
}

function get_serial(): Promise<SerialPort | null> {
    // Return a Serial object representing the first microbit connected
    return find_microbit()
        .then((device_list: SerialPort.PortInfo[]) => {
            if (device_list && device_list[0].path) {
                return new SerialPort(device_list[0].path);
            } else if (device_list && device_list[0].comName) {
                return new SerialPort(device_list[0].comName);
            } else return null;
        });
    
}

function version() {
    // Return version information of the connected microbit 
}

export class Microbit {
    device: SerialPort | null;

    async setup() {
        if (!this.device) this.device = await get_serial();
    }

    constructor(port?: string) {
        if (port) {
            this.device = new SerialPort(port);
        } else {
            this.device = null;
        }
    }

    async execute(commands: string[]) {
        // Execute a set of commands on the microbit
        this.raw_on();
        await sleep(100);
        let result: string = "";
        commands.forEach(async (command: string) => {
            this.device.write(command);
            await sleep(50);
            this.device.write('\x04');
            const response = this.flush_to_msg('\x04>');
            const [out, err] = response.substring(2, -2).split('\x04', 1);
            result += out;
            if (err) return {response: '', err: err};
        });
        await sleep(100);
        this.raw_on();
        return { response: result, err: '' };
    }


    async ls(): Promise<String[]> {
        if (!this.device) await this.setup();
        return this.execute(this.device, [
            'import os',
            'print(os.listdir())',
        ]);
    }
    rm() {}
    put() {}
    get() {}
}
