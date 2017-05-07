/**
 * One way data flow using plain javascript:
 *
 *      change the state -> emit event -> dom updates automatically
 *
 * See https://github.com/cs01/stator for examples and documentation
 */


function _clone_obj(obj){
    if(obj === undefined){return undefined}
    return JSON.parse(JSON.stringify(obj))
}

function _check_type_match(a, b, key){
    if(a !== undefined ){
        let old_type = typeof a
        , new_type = typeof b
        if(old_type !== new_type){
            throw `Type Error: attempted to change ${key} from ${old_type} to ${new_type}`
        }
    }
}

const stator = {
    /**
     * Set the initial state. This can only be once, and must be done before the
     * state has been modified.
     * @param initial_state: Initial state object
     */
    create_state: function(initial_state){
        if(stator._state_created){
            throw 'cannot create more than one global state'
        }
        stator._state_created = true
        let cloned_initial_state = _clone_obj(initial_state)

        return new Proxy(cloned_initial_state, {
            /**
             * Set a value of the state. If it changed, an event will be dispatched after debounce period (see stator.options).
             * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/handler/set
             * @param target: obj to update
             * @param key: Key of State object to modify
             * @param value: New value of the key
             * @param receiver
             */
            set: function(target, key, value, receiver){
                if(!(key in target)){
                    throw `cannot create new key after initialization (attempted to create ${key})`
                }

                let oldval = target[key]

                // update the state
                if(oldval !== value){

                    if(stator.options.debug) {
                        console.log('stator ' + key, oldval, ' -> ', value)
                    }

                    // type check
                    if(stator.options.type_check){
                        _check_type_match(oldval, value, key)
                    }

                    // update the value
                    target[key] = _clone_obj(value)

                    // suppress active timeouts (if any)
                    if(stator._debounce_timeout){
                        stator._clear_debounce_timeout()
                        stator._suppressed_event_count++
                    }

                    // emit event, or schedule event to be emitted so that Reactors and listeners are notified
                    // that the state changed
                    if(stator._suppressed_event_count >= stator.options.max_suppressed_event_count){
                        // emit event immediately since we have suppressed enough already
                        if(stator.options.debug){
                            console.log(`suppressed ${stator._suppressed_event_count} events (${stator.options.max_suppressed_event_count} max). Emitting event now.`)
                        }
                        stator._dispatch_event()
                    }else{
                        // delay event emission and set new timeout id
                        stator._debounce_timeout = setTimeout(stator._dispatch_event, stator.options.debounce_ms)
                    }
                }
                return true  // the "set" trap returns true on success
            },
            /**
             * Get value of one of the keys in the current state.
             * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/handler/get
             * @param target; The target object
             * @param key; Key to get value for
             */
            get: function(target, key){
                // the "get" trap returns a value
                if(key in target){
                    return target[key]
                }else{
                    throw `attempted to access key that was not set during initialization: ${key}`
                }
            },
        })
    },
    options: {
        // emit event only after this much time has passed and an update has not occurred
        debounce_ms: 10,
        // emit event within debounce timeout if event has been suppressed this many times
        // <= 0 will send all events immediately
        // max wait time for event emission in milliseconds is: debounce_ms * max_suppressed_event_count
        max_suppressed_event_count: 10,
        // raise error if user attempts to set state with different type
        type_check: true,
        // print debug info to console
        debug: false,
    },
    /**
     * Add listener(s) to state changes
     * @param func: Function or array of functions to be called when event is dispatched due to State updates
     */
    add_listener(func){
        if(Array.isArray(func)){
            func.map(f => window.addEventListener('state_changed', f))
        }else{
            window.addEventListener('state_changed', func)
        }
    },
    /**
     * Plain object that has a proxy to emit events each time a propery of it is changed
     */
    _state: {},
    /**
     * Dispatch the event, and update related variables as needed
     */
    _dispatch_event: function(){
        window.dispatchEvent(new CustomEvent('state_changed'))
        stator._clear_debounce_timeout()
        stator._suppressed_event_count = 0
    },
    /**
     * Clear the debounce timeout
     */
    _clear_debounce_timeout: function(){
        clearTimeout(stator._debounce_timeout)
        stator._debounce_timeout = null
    },
    /**
     * Debounce timeout
     */
    _debounce_timeout: undefined,
    /**
     * Suppressed event count.
     * Incremented when a queued timeout is replaced with new timeout. If queued timeouts keep getting
     * replaced, events never get dispatched. This is an "escape hatch" for that.
     * Set to zero when event is dispatched.
     */
    _suppressed_event_count: 0,
    _state_created: false
}

/**
 * Global object that emits an event when its properties change.
 * `Reactor`s listen for these events.
 * Event emission is optimized by debouncing.
 *
 * Note that the actual data lives in stator._state. This is just a proxy for that data.
 * The data cannot be located within this proxy because updating it will result in infinite recursion.
 * i.e. `State.myvar = 'a'`
 * `State.other_var = [1, 2, 3]`
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/handler
 */
// const state =

/**
 * Reactive component that links data to the DOM
 *
 * @param el (string): JavaScript selector to have its inner html updated (i.e. '#my_id')
 *                      Selector must match exactly one node.
 * @param options (object)
 * @param html_callback (function): returns html
 */
function Reactor(element, options, html_callback){
    let that = this
    this._render_timeout = null
    // select from dom once
    let nodes = document.querySelectorAll(element)
    if(nodes.length !== 1){
        throw `Reactor: querySelector "${element}" matched ${nodes.length} nodes. Expected 1.`
    }
    this.element = element
    this.node = nodes[0]

    let default_options = {
        should_render: this.should_render,  // a function that returns a boolean (defaults to true)
        updated_html: this.updated_html,  // function called after html is updated
        listen_to_global_state: true,  // render this Reactor when global state changes
        state: {},  // Reactor's state (not global state)
        debug: false,  // prints extra output when true
    }
    let invalid_options = Object.keys(options)
                            .filter(o => Object.keys(default_options).indexOf(o) === -1)
    if(invalid_options.length > 0){
        invalid_options.map(o=>console.error(`Reactor got invalid option "${o}"`))
        return
    }
    // set options
    this.options = Object.assign(default_options, options)

    // store the render callback
    if(!html_callback || typeof html_callback !== 'function'){
        throw `Reactor did not receive a render callback function. This argument should be a function that returns html to populate the DOM element.`
    }
    this._html_callback = html_callback.bind(this)  // this._html_callback is called in this.render
    let bound_render = this.render.bind(this)  // bind this Reactor to the update function

    if(this.options.listen_to_global_state){
        // call render function when global state changes
        stator.add_listener(bound_render)
    }

    this._data = _clone_obj(this.options.state || {})

    // re-render on changes to this Reactor's state
    this.state = new Proxy(this._data, {
        set: function(target, key, value, receiver){
            if(!(key in target)){
                throw `cannot create new key after initialization (attempted to create ${key})`
            }
            if(that.options.debug) {
                console.log(that.element + ': ' + key, target[key], ' -> ', value)
            }
            _check_type_match(target[key], value, key)
            target[key] = value

            // limit update rate rate
            clearTimeout(that._render_timeout)
            const DEBOUNCE_MS = 10
            that._render_timeout = setTimeout(bound_render, DEBOUNCE_MS)
        },
        get: function(target, key){
            // the "get" trap returns a value
            if(key in target){
                return target[key]
            }else{
                throw `attempted to access key that was not set during initialization: ${key}`
            }
        },
    })

    this.render() // call the update function immediately so it renders itself
}

/**
 * Calls the render callback, and updates the inner html
 * of the Component's node if the content changed.
 */
Reactor.prototype.render = function(){
    clearTimeout(this._render_timeout)

    if(this.options.should_render(this)){
        let node_html = this._html_callback(this)
        // update dom only if the return value of render changed
        if(this.force_update || (node_html !== this.old_node_html)){
            this.node.innerHTML = node_html
            // cache the html that has been rendered
            this.old_node_html = node_html
            this.options.updated_html(this)
            this.force_update = false
        }
    }
}

// default function to determine if a Reactor should render
// This function is called just before its render function is evaluated, and
// determines whether render and the html is updated or not
Reactor.prototype.should_render = function(r){return true}
// this function is called after the DOM updates html for a Reactor
Reactor.prototype.updated_html = function(r){}
Reactor.prototype.updated_html = function(r){}
