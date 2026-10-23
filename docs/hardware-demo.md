# Hardware demo: the checker predicts it, the real board proves it

Goal: one 30-second shot where Hardwright's Board checker flags a wiring mistake and a REAL ESP32 then fails the way it predicted, and works once fixed.
Honest framing for the video and Devpost: **the checker predicted a documented hardware hazard; it did not measure the board.**

## Shopping list (about 500 to 900 rupees, local electronics shop)

* 1 x ESP32 dev board with an **ESP32-WROOM-32** or **WROOM-32E** module (DevKitC style, 30 or 38 pin). Buy 2 if cheap (a spare for mistakes).
* 1 x USB cable **with data lines** that fits the board (micro-USB or USB-C). Charge-only cables will not show a serial port.
* 1 x half-size breadboard, 10 to 20 jumper wires (male-male), 2 x tactile push buttons.
* A few 10 kΩ resistors (and optionally 1 LED + 330 Ω).
* Avoid ESP32-WROVER, ESP32-S2, S3 or C3 boards for this shot: their flash and strapping behave differently.

## The experiment

The ESP32 reads **GPIO12 (MTDI)** at reset to choose the flash supply voltage. On a 3.3 V flash module, GPIO12 must be **low** (or floating) at reset. A button with an external pull-up on GPIO12 holds it HIGH at power-up, so the chip powers the flash at the wrong voltage and the boot fails. This is the classic "my board will not boot" mistake.

1. **Fault wiring (what the checker flags):** push button between GPIO12 and GND, plus a 10 kΩ pull-up from GPIO12 to 3V3. Template to show in the app: `fault_strapping_pin` ("wake button on a strapping pin"): rung B4 fails.
2. Connect USB, open a serial monitor at 115200 baud (Arduino IDE Serial Monitor, PlatformIO or `screen`/PuTTY). Press the board's EN (reset) button or reconnect USB.
   **Expected:** the ROM boot messages repeat in a loop with a flash error (for example `flash read err, 1000`), and your sketch never starts. If your board boots anyway, do not fake it: it means that board/module is not susceptible (for example a different flash voltage); tell me and we change the shot.
3. **Fix wiring (what the checker passes):** move the button wire and the pull-up to **GPIO14** (a safe pin). Use `INPUT_PULLUP` in firmware and drop the external resistor if you like. Template: `clean_sensor`.
4. Reset again. **Expected:** the sketch boots and prints `button ready`, then `pressed` / `released` as you press the button.

## Test sketch (Arduino)

```cpp
// Wake-button demo. Wire the button between GPIO14 and GND for the fixed case.
const int BTN = 14;
void setup() {
  Serial.begin(115200);
  pinMode(BTN, INPUT_PULLUP);
  Serial.println("button ready");
}
bool last = true;
void loop() {
  bool now = digitalRead(BTN);
  if (now != last) { Serial.println(now ? "released" : "pressed"); last = now; delay(30); }
}
```

For the fault wiring the sketch is the same; it simply never runs (that is the point).

## Shot list (about 30 seconds, no voice needed beyond one line each)

1. App (3 s): prompt "Check my ESP32 board: wake button on GPIO12 with a pull-up". The agent loads the template and the report card shows the red check: "wake button on a boot-strapping pin".
2. Desk (7 s): the breadboard with the button on GPIO12; the serial monitor shows the boot loop with the flash error. Caption: "Predicted by the checker."
3. Desk (5 s): move the wire to GPIO14.
4. Desk (7 s): serial monitor shows `button ready` and `pressed`. Caption: "Fixed."
5. App (5 s): the agent re-checks the corrected design; all checks green.

## What I need from you after you buy

* A photo of the board (to confirm the module marking) and the serial output of the fault case (paste the text). If it boots anyway, tell me before filming.
* Do not claim more than this: the checker's strapping-pin rule is conservative, it flags any use of a strapping pin, and the demo shows one real consequence of it.
