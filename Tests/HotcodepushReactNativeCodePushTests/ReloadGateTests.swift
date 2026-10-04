@testable import HotcodepushReactNativeCodePush
import XCTest

final class ReloadGateTests: XCTestCase {
    private var reloadCount = 0
    private var gate: ReloadGate!

    override func setUp() {
        super.setUp()
        reloadCount = 0
        gate = ReloadGate { [unowned self] in self.reloadCount += 1 }
    }

    func testShouldNotReloadWhenTheBundleSwitchesBeforeTheHostAsked() {
        gate.requestReload()

        XCTAssertEqual(reloadCount, 0)
        XCTAssertFalse(gate.hasHostAsked)
    }

    func testShouldHoldTheReloadWhileTheInstanceStartsAndFireItOnceOnTheFirstContent() {
        gate.handleHostAsking()
        gate.requestReload()
        gate.requestReload()

        XCTAssertEqual(reloadCount, 0)
        XCTAssertFalse(gate.handleContentDidAppear())
        XCTAssertEqual(reloadCount, 1)
    }

    func testShouldReleaseAHeldReloadWhenTheCoreReportsTheRollback() {
        gate.handleHostAsking()
        gate.requestReload()
        gate.handleRolledBack()

        XCTAssertEqual(reloadCount, 1)
    }

    func testShouldNotReloadOnARollbackWhenNoReloadIsHeld() {
        gate.handleHostAsking()
        gate.handleRolledBack()

        XCTAssertEqual(reloadCount, 0)
    }

    func testShouldReloadAtOnceWhenTheInstanceHasShownContent() {
        gate.handleHostAsking()
        XCTAssertTrue(gate.handleContentDidAppear())
        gate.requestReload()

        XCTAssertEqual(reloadCount, 1)
    }

    func testShouldNotReloadAgainWhenASwitchArrivesWhileAReloadIsUnderWay() {
        gate.handleHostAsking()
        _ = gate.handleContentDidAppear()
        gate.requestReload()
        gate.requestReload()

        XCTAssertEqual(reloadCount, 1)
        XCTAssertFalse(gate.handleContentDidAppear())
    }

    func testShouldHoldTheNextReloadWhenTheHostAsksAgainAfterAReload() {
        gate.handleHostAsking()
        _ = gate.handleContentDidAppear()
        gate.requestReload()
        gate.handleHostAsking()
        gate.requestReload()

        XCTAssertEqual(reloadCount, 1)
        XCTAssertFalse(gate.handleContentDidAppear())
        XCTAssertEqual(reloadCount, 2)
    }
}
