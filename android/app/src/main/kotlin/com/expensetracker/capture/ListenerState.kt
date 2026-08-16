package com.expensetracker.capture

/**
 * Static, in-process tracking of whether the listener is actually bound
 * right now (agents.md §10's "know when it's dead"). Written by the
 * service lifecycle callbacks, read by the heartbeat worker. Reset to
 * false whenever the process starts, since a fresh process can't assume
 * the listener survived.
 */
object ListenerState {
    @Volatile
    var bound: Boolean = false
}
